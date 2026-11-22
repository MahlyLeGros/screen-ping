//! Prototype: can Tauri reproduce the Electron overlay?
//! Must-haves: clicks always pass through, focus never stolen, stays above
//! fullscreen apps, video and sound play unmuted without a user gesture.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

#[cfg(windows)]
mod win32;

#[derive(Clone, Serialize, Deserialize)]
pub struct Ping {
    /// "image" | "video" | "audio"
    kind: String,
    url: String,
    /// Optional separate sound played with an image.
    audio_url: Option<String>,
    duration_ms: Option<u64>,
}

fn overlay(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())
}

/// Called by the control window: send a ping to the overlay.
#[tauri::command]
fn send_ping(app: AppHandle, ping: Ping) -> Result<(), String> {
    overlay(&app)?.emit("ping", ping).map_err(|e| e.to_string())
}

/// Called by the overlay once media is preloaded: cover the primary monitor
/// and show without activating.
#[tauri::command]
fn show_overlay(app: AppHandle) -> Result<(), String> {
    let win = overlay(&app)?;
    let monitor = win
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no monitor")?;
    let pos = *monitor.position();
    let size = *monitor.size();
    win.set_position(PhysicalPosition::new(pos.x, pos.y))
        .map_err(|e| e.to_string())?;
    win.set_size(PhysicalSize::new(size.width, size.height))
        .map_err(|e| e.to_string())?;
    win.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;

    #[cfg(windows)]
    {
        let hwnd = win.hwnd().map_err(|e| e.to_string())?;
        win32::show_topmost_no_activate(hwnd);
        win32::enable_zorder_guard(hwnd);
    }
    #[cfg(not(windows))]
    win.show().map_err(|e| e.to_string())?;
    Ok(())
}

/// Called by the overlay when the ping ends: hide and park off-screen.
#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    let win = overlay(&app)?;
    #[cfg(windows)]
    {
        let hwnd = win.hwnd().map_err(|e| e.to_string())?;
        win32::disable_zorder_guard(hwnd);
    }
    win.hide().map_err(|e| e.to_string())?;
    let _ = win.set_position(PhysicalPosition::new(-32000, -32000));
    let _ = win.set_size(PhysicalSize::new(1, 1));
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let win = overlay(app.handle())?;
            win.set_ignore_cursor_events(true)?;
            #[cfg(windows)]
            win32::make_tool_window(win.hwnd()?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![send_ping, show_overlay, hide_overlay])
        .run(tauri::generate_context!())
        .expect("error while running Screen Ping prototype");
}
