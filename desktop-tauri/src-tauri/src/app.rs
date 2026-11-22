//! App lifecycle, windows, tray and menu. Ported from desktop/main/main.ts,
//! windows.ts and tray.ts.

use crate::host::{Host, AUDIO, OVERLAY};
use crate::displays;
use screenping_core::overlay::{OverlayQueue, QueueOutput};
use screenping_core::socket::{SocketEvents, SocketManager};
use screenping_core::{Api, SettingsStore};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::tray::{MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

pub const LOGIN: &str = "login";
pub const MAIN: &str = "main";
pub const MENU: &str = "menu";

const BRIDGE: &str = include_str!("bridge.js");
/// Same flags as Electron's main.ts, plus unmuted autoplay. Every webview in
/// the app must use identical arguments (one shared WebView2 environment).
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
--autoplay-policy=no-user-gesture-required";

const MAIN_SIZE: (f64, f64) = (800.0, 480.0);
const COMPACT_WIDTH: f64 = 690.0;
const FULL_MIN_HEIGHT: f64 = 420.0;
const COMPACT_MIN_HEIGHT: f64 = 120.0;
const TRAY_CLICK_GRACE: Duration = Duration::from_millis(600);

#[derive(Default)]
struct MenuState {
    hidden_at: Option<Instant>,
    pending_show: bool,
    anchor: Option<(f64, f64)>,
}

pub struct App {
    pub handle: AppHandle,
    pub store: SettingsStore,
    pub api: Api,
    pub socket: SocketManager,
    pub queue: OverlayQueue,
    pub host: Arc<Host>,
    pub version: String,
    connected: AtomicBool,
    overlay_initialized: AtomicBool,
    handling_expiry: AtomicBool,
    user_id: Mutex<Option<String>>,
    menu: Mutex<MenuState>,
    pending_tab: Mutex<Option<String>>,
    tray: Mutex<Option<(TrayIcon, Instant)>>,
}

// ----- socket + queue glue ----------------------------------------------

struct Events(OnceLock<Weak<App>>);
impl Events {
    fn app(&self) -> Option<Arc<App>> {
        self.0.get()?.upgrade()
    }
}
impl SocketEvents for Events {
    fn on_status(&self, connected: bool) {
        if let Some(a) = self.app() {
            a.connected.store(connected, Ordering::SeqCst);
            a.refresh_tray();
        }
    }
    fn on_deliver(&self, payload: Value) {
        if let Some(a) = self.app() {
            a.queue.enqueue(payload, a.store.get().paused);
        }
    }
    fn on_revoke(&self, id: String) {
        if let Some(a) = self.app() {
            a.queue.revoke(id);
        }
    }
    fn on_start(&self, id: String, at: i64) {
        if let Some(a) = self.app() {
            a.queue.schedule_start(id, at);
        }
    }
    fn on_draw(&self, event: &str, payload: Value) {
        if let Some(a) = self.app() {
            a.queue.draw(event, payload);
        }
    }
    fn on_presence(&self, payload: Value) {
        if let Some(a) = self.app() {
            let _ = a.handle.emit_to(MAIN, "desktop:presence", payload);
        }
    }
    fn on_friends_update(&self, _payload: Value) {
        if let Some(a) = self.app() {
            let _ = a.handle.emit_to(MAIN, "desktop:friends", Value::Null);
        }
    }
    fn on_session_expired(&self) {
        if let Some(a) = self.app() {
            tauri::async_runtime::spawn(async move { a.handle_session_expired().await });
        }
    }
    fn idle_seconds(&self) -> u64 {
        #[cfg(windows)]
        return crate::win32::idle_seconds();
        #[cfg(not(windows))]
        0
    }
}

struct Output(OnceLock<SocketManager>);
impl QueueOutput for Output {
    fn ack(&self, id: &str, status: &str) {
        if let Some(s) = self.0.get().cloned() {
            let (id, status) = (id.to_string(), status.to_string());
            tauri::async_runtime::spawn(async move { s.ack_message(&id, &status).await });
        }
    }
    fn prepared(&self, id: &str, group: &str) {
        if let Some(s) = self.0.get().cloned() {
            let (id, group) = (id.to_string(), group.to_string());
            tauri::async_runtime::spawn(async move { s.prepared_message(&id, &group).await });
        }
    }
}

// ----- windows --------------------------------------------------------------

fn builder<'a>(app: &'a AppHandle, label: &'a str, page: &str) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(format!("{page}.html").into()))
        .title("Screen Ping")
        .initialization_script(BRIDGE)
        .additional_browser_args(BROWSER_ARGS)
        .decorations(false)
}

impl App {
    pub fn new(handle: AppHandle, store: SettingsStore, version: String) -> Arc<App> {
        let api = Api::new(store.clone(), &version);
        let host = Arc::new(Host::new(handle.clone(), store.clone()));
        let events = Arc::new(Events(OnceLock::new()));
        let output = Arc::new(Output(OnceLock::new()));
        let socket = SocketManager::new(api.clone(), events.clone(), &version);
        let _ = output.0.set(socket.clone());
        let queue = OverlayQueue::new(host.clone(), output, store.server_url());
        let app = Arc::new(App {
            handle,
            store,
            api,
            socket,
            queue,
            host,
            version,
            connected: AtomicBool::new(false),
            overlay_initialized: AtomicBool::new(false),
            handling_expiry: AtomicBool::new(false),
            user_id: Mutex::new(None),
            menu: Mutex::new(MenuState::default()),
            pending_tab: Mutex::new(None),
            tray: Mutex::new(None),
        });
        let _ = events.0.set(Arc::downgrade(&app));
        let weak = Arc::downgrade(&app);
        app.api.set_session_expired_handler(move || {
            if let Some(a) = weak.upgrade() {
                tauri::async_runtime::spawn(async move { a.handle_session_expired().await });
            }
        });
        app
    }

    fn win(&self, label: &str) -> Option<WebviewWindow> {
        self.handle.get_webview_window(label)
    }

    /// Overlay + hidden audio window live for the whole session.
    pub fn create_overlay_windows(self: &Arc<Self>) -> tauri::Result<()> {
        let overlay = builder(&self.handle, OVERLAY, "overlay")
            .transparent(true)
            .shadow(false)
            .always_on_top(false)
            .skip_taskbar(true)
            .focused(false)
            .resizable(false)
            .visible(false)
            .position(-32000.0, -32000.0)
            .inner_size(1.0, 1.0)
            .build()?;
        overlay.set_ignore_cursor_events(true)?;
        #[cfg(windows)]
        crate::win32::make_tool_window(overlay.hwnd()?);

        // Audio-only pings. Kept "visible" off-screen so WebView2 never
        // suspends it; click-through and never focused.
        let audio = WebviewWindowBuilder::new(&self.handle, AUDIO, WebviewUrl::External("about:blank".parse().unwrap()))
            .title("Screen Ping")
            .additional_browser_args(BROWSER_ARGS)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .skip_taskbar(true)
            .focused(false)
            .resizable(false)
            .visible(false)
            .position(-32000.0, -32000.0)
            .inner_size(1.0, 1.0)
            .build()?;
        audio.set_ignore_cursor_events(true)?;
        #[cfg(windows)]
        {
            let hwnd = audio.hwnd()?;
            crate::win32::make_tool_window(hwnd);
            crate::win32::show_topmost_no_activate(hwnd);
        }
        crate::host::mark_webview_visible(&audio);
        Ok(())
    }

    pub fn show_login(self: &Arc<Self>) {
        if let Some(w) = self.win(LOGIN) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let built = builder(&self.handle, LOGIN, "login")
            .inner_size(380.0, 560.0)
            .resizable(false)
            .maximizable(false)
            .background_color(tauri::window::Color(3, 3, 4, 255))
            .center()
            .build();
        let Ok(w) = built else { return };
        let me = Arc::downgrade(self);
        w.on_window_event(move |e| {
            if let WindowEvent::Destroyed = e {
                if let Some(a) = me.upgrade() {
                    a.api.cancel_browser_login();
                    if a.store.access_token().is_none() {
                        a.handle.exit(0);
                    }
                }
            }
        });
    }

    fn close(&self, label: &str) {
        if let Some(w) = self.win(label) {
            let _ = w.destroy();
        }
    }

    pub fn show_main(self: &Arc<Self>) {
        if let Some(w) = self.win(MAIN) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let s = self.store.get();
        let me = Arc::downgrade(self);
        let built = builder(&self.handle, MAIN, "app")
            .inner_size(if s.compact { COMPACT_WIDTH } else { MAIN_SIZE.0 }, if s.compact { 132.0 } else { MAIN_SIZE.1 })
            .min_inner_size(560.0, if s.compact { COMPACT_MIN_HEIGHT } else { FULL_MIN_HEIGHT })
            .resizable(!s.compact)
            .shadow(true)
            .always_on_top(s.always_on_top)
            .background_color(tauri::window::Color(3, 3, 4, 255))
            .center()
            .on_page_load(move |w, payload| {
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    if let Some(a) = me.upgrade() {
                        if let Some(tab) = a.pending_tab.lock().unwrap().take() {
                            let _ = w.emit_to(MAIN, "app:open-tab", tab);
                        }
                    }
                }
            })
            .build();
        if let Ok(w) = built {
            let _ = w.set_focus();
        }
    }

    fn apply_window_mode(&self, compact: bool) {
        let Some(w) = self.win(MAIN) else { return };
        let scale = w.scale_factor().unwrap_or(1.0);
        let cur = w.inner_size().map(|s| s.to_logical::<f64>(scale)).unwrap_or(LogicalSize::new(MAIN_SIZE.0, MAIN_SIZE.1));
        let width = if compact { COMPACT_WIDTH } else { MAIN_SIZE.0 };
        let height = if compact { cur.height } else { MAIN_SIZE.1 };
        let _ = w.set_min_size(Some(LogicalSize::new(560.0, if compact { COMPACT_MIN_HEIGHT } else { FULL_MIN_HEIGHT })));
        let _ = w.set_resizable(!compact);
        let _ = w.set_size(LogicalSize::new(width, height));
    }

    pub fn resize_to_content(&self, win: &WebviewWindow, height: f64) {
        let compact = self.store.get().compact;
        let (min, max) = if compact { (96.0, 400.0) } else { (FULL_MIN_HEIGHT, 900.0) };
        let target = height.round().clamp(min, max);
        let scale = win.scale_factor().unwrap_or(1.0);
        if let Ok(cur) = win.inner_size() {
            let cur = cur.to_logical::<f64>(scale);
            if (cur.height - target).abs() >= 1.0 {
                let _ = win.set_size(LogicalSize::new(cur.width, target));
            }
        }
    }

    pub fn open_tab(self: &Arc<Self>, tab: &str) {
        if self.store.get().compact {
            self.store.update(|s| s.compact = false);
            self.apply_window_mode(false);
        }
        let existed = self.win(MAIN).is_some();
        if !existed {
            *self.pending_tab.lock().unwrap() = Some(tab.to_string());
        }
        self.show_main();
        if existed {
            let _ = self.handle.emit_to(MAIN, "app:open-tab", tab);
        }
        self.push_state();
    }

    // ----- menu popup ---------------------------------------------------

    fn ensure_menu(self: &Arc<Self>) -> Option<WebviewWindow> {
        if let Some(w) = self.win(MENU) {
            return Some(w);
        }
        let w = builder(&self.handle, MENU, "menu")
            .inner_size(278.0, 360.0)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .shadow(true)
            .visible(false)
            .background_color(tauri::window::Color(6, 6, 10, 255))
            .build()
            .ok()?;
        let me = Arc::downgrade(self);
        w.on_window_event(move |e| {
            if let WindowEvent::Focused(false) = e {
                if let Some(a) = me.upgrade() {
                    a.hide_menu();
                }
            }
        });
        *self.menu.lock().unwrap() = MenuState::default();
        Some(w)
    }

    pub fn hide_menu(&self) {
        if let Some(w) = self.win(MENU) {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
                self.menu.lock().unwrap().hidden_at = Some(Instant::now());
            }
        }
    }

    fn toggle_menu(self: &Arc<Self>) {
        let anchor = self.handle.cursor_position().ok().map(|p| (p.x, p.y));
        {
            let mut m = self.menu.lock().unwrap();
            m.anchor = anchor;
            // The click that blurred (and hid) the popup must not reopen it.
            if m.hidden_at.is_some_and(|t| t.elapsed() < Duration::from_millis(250)) {
                return;
            }
        }
        if let Some(w) = self.win(MENU) {
            if w.is_visible().unwrap_or(false) {
                self.hide_menu();
                return;
            }
        }
        self.show_menu();
    }

    fn show_menu(self: &Arc<Self>) {
        let Some(w) = self.ensure_menu() else { return };
        self.menu.lock().unwrap().pending_show = true;
        let _ = w.emit_to(MENU, "app:state", self.state());
        let me = Arc::downgrade(self);
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            if let Some(a) = me.upgrade() {
                let pending = std::mem::take(&mut a.menu.lock().unwrap().pending_show);
                if pending {
                    a.reveal_menu();
                }
            }
        });
    }

    /// Just above the click point, centred on it, inside the work area.
    fn position_menu(&self, w: &WebviewWindow) {
        let anchor = self.menu.lock().unwrap().anchor;
        let Some((px, py)) = anchor.or_else(|| self.handle.cursor_position().ok().map(|p| (p.x, p.y))) else { return };
        let Some(monitor) = self.handle.monitor_from_point(px, py).ok().flatten() else { return };
        let work = monitor.work_area();
        let size = w.outer_size().unwrap_or_default();
        let gap = (8.0 * monitor.scale_factor()).round() as i32;
        let (width, height) = (size.width as i32, size.height as i32);
        let (wx, wy, ww, wh) = (work.position.x, work.position.y, work.size.width as i32, work.size.height as i32);
        let x = (px as i32 - width / 2).clamp(wx + gap, (wx + ww - width - gap).max(wx + gap));
        let y = (py as i32 - height - gap).clamp(wy + gap, (wy + wh - height - gap).max(wy + gap));
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }

    fn reveal_menu(&self) {
        let Some(w) = self.win(MENU) else { return };
        self.position_menu(&w);
        let _ = w.show();
        let _ = w.set_focus();
    }

    pub fn resize_menu(&self, width: f64, height: f64) {
        let Some(w) = self.win(MENU) else { return };
        if height < 48.0 {
            return;
        }
        let _ = w.set_size(LogicalSize::new(width.round(), height.round()));
        let pending = std::mem::take(&mut self.menu.lock().unwrap().pending_show);
        if pending {
            self.reveal_menu();
        } else if w.is_visible().unwrap_or(false) {
            self.position_menu(&w);
        }
    }

    // ----- tray ---------------------------------------------------------

    fn ensure_tray(self: &Arc<Self>) {
        let mut slot = self.tray.lock().unwrap();
        if let Some((t, _)) = slot.as_ref() {
            let _ = t.set_visible(true);
            return;
        }
        #[cfg(windows)]
        let light = crate::win32::light_taskbar();
        #[cfg(not(windows))]
        let light = false;
        let bytes: &[u8] = if light {
            include_bytes!("../icons/tray-icon-dark.png")
        } else {
            include_bytes!("../icons/tray-icon.png")
        };
        let me = Arc::downgrade(self);
        let tray = TrayIconBuilder::with_id("main")
            .icon(Image::from_bytes(bytes).expect("tray icon"))
            .tooltip("Screen Ping — connecting…")
            .show_menu_on_left_click(false)
            .on_tray_icon_event(move |_tray, event| {
                let TrayIconEvent::Click { button_state: MouseButtonState::Up, .. } = event else { return };
                let Some(a) = me.upgrade() else { return };
                // Windows often fires a fake click right after the icon is created.
                let ready = a.tray.lock().unwrap().as_ref().map(|(_, t)| t.elapsed() >= TRAY_CLICK_GRACE);
                if ready == Some(true) {
                    a.toggle_menu();
                }
            })
            .build(&self.handle);
        if let Ok(t) = tray {
            *slot = Some((t, Instant::now()));
        }
    }

    pub fn refresh_tray(&self) {
        if let Some((t, _)) = self.tray.lock().unwrap().as_ref() {
            let s = self.store.get();
            let tip = if !s.online {
                "Screen Ping — offline".to_string()
            } else if self.connected.load(Ordering::SeqCst) {
                format!("Screen Ping — connected{}", if s.paused { " (paused)" } else { "" })
            } else {
                "Screen Ping — connecting…".to_string()
            };
            let _ = t.set_tooltip(Some(tip));
        }
        self.push_state();
    }

    // ----- state ----------------------------------------------------------

    pub fn state(&self) -> Value {
        let s = self.store.get();
        json!({
            "version": self.version,
            "packaged": !cfg!(debug_assertions),
            "username": s.saved_username,
            "userId": *self.user_id.lock().unwrap(),
            "serverUrl": self.store.server_url(),
            "connected": self.connected.load(Ordering::SeqCst),
            "online": s.online,
            "paused": s.paused,
            "launchAtLogin": s.launch_at_login,
            "alwaysOnTop": s.always_on_top,
            "compact": s.compact,
            "overlayDisplayId": s.overlay_display_id,
            "displays": displays::list(&self.handle),
            // Updates come in step 3 of the migration.
            "update": { "state": "idle" },
            "latestVersion": Value::Null,
            "outdated": false,
        })
    }

    pub fn push_state(&self) {
        let state = self.state();
        let menu_live = self.menu.lock().unwrap().pending_show;
        for (label, w) in self.handle.webview_windows() {
            if label == OVERLAY || label == AUDIO {
                continue;
            }
            // A hidden menu re-rendering can flicker the cursor elsewhere.
            if label == MENU && !menu_live && !w.is_visible().unwrap_or(false) {
                continue;
            }
            let _ = w.emit_to(label.as_str(), "app:state", state.clone());
        }
    }

    // ----- session ------------------------------------------------------

    pub fn overlay_initialized(self: &Arc<Self>) {
        if !self.overlay_initialized.swap(true, Ordering::SeqCst) {
            self.reconnect_socket();
        }
    }

    pub fn reconnect_socket(self: &Arc<Self>) {
        let s = self.store.get();
        if !s.online || s.access_token.is_none() {
            let me = self.clone();
            tauri::async_runtime::spawn(async move {
                me.socket.disconnect().await;
                me.connected.store(false, Ordering::SeqCst);
                me.refresh_tray();
            });
            return;
        }
        // The server may deliver pending pings right away: wait for the overlay.
        if !self.overlay_initialized.load(Ordering::SeqCst) {
            return;
        }
        self.socket.connect();
    }

    pub async fn bootstrap(self: Arc<Self>) {
        if self.api.try_restore_session().await {
            self.start_app();
        } else {
            self.show_login();
        }
    }

    pub fn start_app(self: &Arc<Self>) {
        self.handling_expiry.store(false, Ordering::SeqCst);
        if self.store.access_token().is_some() && !self.store.get().online {
            self.store.update(|s| s.online = true);
        }
        self.ensure_tray();
        self.ensure_menu();
        self.reconnect_socket();
        self.refresh_tray();
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(user) = me.api.fetch_me().await {
                *me.user_id.lock().unwrap() = user.get("id").and_then(Value::as_str).map(String::from);
                me.push_state();
            }
        });
    }

    pub fn after_login(self: &Arc<Self>) {
        self.close(LOGIN);
        self.start_app();
    }

    pub async fn logout(self: &Arc<Self>) {
        self.socket.disconnect().await;
        self.api.revoke_current_session().await;
        self.store.clear_session_tokens();
        self.api.clear_login_credentials();
        *self.user_id.lock().unwrap() = None;
        self.connected.store(false, Ordering::SeqCst);
        self.close(MAIN);
        self.close(MENU);
        if let Some((t, _)) = self.tray.lock().unwrap().as_ref() {
            let _ = t.set_visible(false);
        }
        self.show_login();
    }

    async fn handle_session_expired(self: &Arc<Self>) {
        if self.handling_expiry.swap(true, Ordering::SeqCst) {
            return;
        }
        self.socket.disconnect().await;
        self.store.clear_session_tokens();
        *self.user_id.lock().unwrap() = None;
        self.connected.store(false, Ordering::SeqCst);
        self.close(MAIN);
        self.show_login();
        let _ = self
            .handle
            .notification()
            .builder()
            .title("Screen Ping")
            .body("Session expired — please log in again.")
            .show();
        self.refresh_tray();
    }

    // ----- settings & actions (main.ts applySetting / runAction) ----------

    pub fn apply_setting(self: &Arc<Self>, key: &str, value: &Value) {
        let b = value.as_bool().unwrap_or(false);
        match key {
            "online" => {
                self.store.update(|s| s.online = b);
                self.reconnect_socket();
            }
            "paused" => self.store.update(|s| s.paused = b),
            "launchAtLogin" => {
                self.store.update(|s| s.launch_at_login = b);
                crate::apply_autostart(&self.handle, b);
            }
            "alwaysOnTop" => {
                self.store.update(|s| s.always_on_top = b);
                if let Some(w) = self.win(MAIN) {
                    let _ = w.set_always_on_top(b);
                }
            }
            "compact" => {
                self.store.update(|s| s.compact = b);
                self.apply_window_mode(b);
            }
            "overlayDisplayId" => {
                let id = value.as_u64().map(|v| v as u32);
                self.store.update(|s| s.overlay_display_id = id);
            }
            _ => {}
        }
        self.refresh_tray();
    }

    fn open_url(&self, url: &str) {
        let _ = self.handle.opener().open_url(url, None::<&str>);
    }

    pub async fn run_action(self: &Arc<Self>, name: &str) {
        match name {
            "open-window" => self.open_tab("receive"),
            "open-friends" => self.open_tab("friends"),
            "open-send" => self.open_tab("send"),
            "reconnect" => self.socket.reconnect().await,
            "logout" => self.logout().await,
            "quit" => self.handle.exit(0),
            "open-dashboard" => self.open_url(&self.store.server_url()),
            "open-kofi" => self.open_url("https://ko-fi.com/screenping"),
            // Auto-update arrives in step 3 of the migration.
            "check-updates" | "install-update" | "cancel-update" => {}
            _ => {}
        }
        self.refresh_tray();
    }

    pub fn open_browser(&self, url: String) {
        self.open_url(&url);
    }

    pub fn second_instance(self: &Arc<Self>) {
        if self.store.access_token().is_none() {
            self.show_login();
        }
    }
}
