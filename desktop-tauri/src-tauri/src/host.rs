//! The overlay window as seen by the core queue (`OverlayHost`), plus the
//! hidden audio window. Ported from windows.ts (park/position/top-most) and
//! overlayQueue.ts (opacity, audio window, media stop).

use crate::displays;
use screenping_core::overlay::{async_trait_shim::BoxFuture, OverlayHost};
use screenping_core::SettingsStore;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tokio::sync::Notify;

pub const OVERLAY: &str = "overlay";
pub const AUDIO: &str = "audio";
const PARKED: (i32, i32) = (-32000, -32000);

pub struct Host {
    pub app: AppHandle,
    pub store: SettingsStore,
    opacity: Mutex<f64>,
    /// Set by `overlay:cleared` from the renderer.
    pub cleared: Notify,
}

impl Host {
    pub fn new(app: AppHandle, store: SettingsStore) -> Self {
        Self { app, store, opacity: Mutex::new(0.0), cleared: Notify::new() }
    }

    fn win(&self) -> Option<WebviewWindow> {
        self.app.get_webview_window(OVERLAY)
    }

    fn set_opacity_now(&self, value: f64) {
        *self.opacity.lock().unwrap() = value;
        let _ = self.app.emit_to(OVERLAY, "__sp:opacity", json!({ "from": value, "to": value, "ms": 0 }));
    }

    /// Chosen monitor, one pixel short of its height (taskbar fullscreen check).
    fn position(&self, win: &WebviewWindow) {
        let Some(m) = displays::overlay_monitor(&self.app, self.store.get().overlay_display_id) else { return };
        let pos = *m.position();
        let size = *m.size();
        let next = (pos.x, pos.y, size.width, size.height.saturating_sub(1).max(1));
        let cur_pos = win.outer_position().ok();
        let cur_size = win.outer_size().ok();
        if cur_pos.map(|p| (p.x, p.y)) != Some((next.0, next.1)) {
            let _ = win.set_position(PhysicalPosition::new(next.0, next.1));
        }
        if cur_size.map(|s| (s.width, s.height)) != Some((next.2, next.3)) {
            let _ = win.set_size(PhysicalSize::new(next.2, next.3));
        }
    }

    pub fn park_window(&self) {
        let Some(win) = self.win() else { return };
        self.set_opacity_now(0.0);
        let _ = win.hide();
        let _ = win.set_position(PhysicalPosition::new(PARKED.0, PARKED.1));
        let _ = win.set_size(PhysicalSize::new(1, 1));
    }

    fn audio_eval(&self, js: &str) {
        if let Some(w) = self.app.get_webview_window(AUDIO) {
            let _ = w.eval(js);
        }
    }
}

impl OverlayHost for Host {
    fn show(&self) {
        let Some(win) = self.win() else { return };
        self.position(&win);
        let _ = win.set_ignore_cursor_events(true);
        #[cfg(windows)]
        if let Ok(hwnd) = win.hwnd() {
            crate::win32::show_topmost_no_activate(hwnd);
        }
        #[cfg(not(windows))]
        {
            let _ = win.set_always_on_top(true);
            let _ = win.show();
        }
    }

    fn park(&self) {
        self.park_window();
    }

    fn reinforce(&self) {
        let Some(win) = self.win() else { return };
        #[cfg(windows)]
        if let Ok(hwnd) = win.hwnd() {
            crate::win32::show_topmost_no_activate(hwnd);
        }
        #[cfg(not(windows))]
        let _ = win.show();
    }

    fn set_keeper(&self, on: bool) {
        #[cfg(windows)]
        if let Some(win) = self.win() {
            if let Ok(hwnd) = win.hwnd() {
                let app = self.app.clone();
                crate::win32::set_keeper(hwnd, on, move |f| {
                    let _ = app.run_on_main_thread(f);
                });
            }
        }
        #[cfg(not(windows))]
        let _ = on;
    }

    fn opacity(&self) -> f64 {
        *self.opacity.lock().unwrap()
    }

    fn fade(&self, from: f64, to: f64, ms: u64) -> BoxFuture<'_, ()> {
        *self.opacity.lock().unwrap() = to;
        let _ = self.app.emit_to(OVERLAY, "__sp:opacity", json!({ "from": from, "to": to, "ms": ms }));
        Box::pin(async move {
            if ms > 0 {
                tokio::time::sleep(Duration::from_millis(ms)).await;
            }
        })
    }

    fn send(&self, channel: &str, payload: Value) {
        let _ = self.app.emit_to(OVERLAY, channel, payload);
    }

    fn clear_renderer(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let notified = self.cleared.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let _ = self.app.emit_to(OVERLAY, "overlay:hide", Value::Null);
            let _ = tokio::time::timeout(Duration::from_millis(500), notified).await;
        })
    }

    fn stop_overlay_media(&self) -> BoxFuture<'_, ()> {
        if let Some(w) = self.win() {
            let _ = w.eval(
                "document.querySelectorAll('audio,video').forEach((el)=>{el.pause();el.currentTime=0;});",
            );
        }
        Box::pin(async {})
    }

    fn play_hidden_audio(&self, url: &str, delay_ms: u64) {
        let url = serde_json::to_string(url).unwrap_or_else(|_| "\"\"".into());
        self.audio_eval(&format!(
            "(()=>{{document.querySelectorAll('audio').forEach((a)=>{{a.pause();a.remove();}});\
             const a=new Audio({url});a.preload='auto';(document.body||document.documentElement).appendChild(a);\
             setTimeout(()=>{{a.play().catch(()=>{{}});}},{delay_ms});}})()"
        ));
    }

    fn stop_hidden_audio(&self) -> BoxFuture<'_, ()> {
        self.audio_eval(
            "document.querySelectorAll('audio,video').forEach((el)=>{el.pause();el.removeAttribute('src');el.load();el.remove();});",
        );
        Box::pin(async {})
    }
}
