//! Screen Ping desktop receiver on Tauri 2.
//!
//! The Rust side replaces Electron's main process (desktop/main). The pages
//! are desktop/renderer, unchanged: `bridge.js` gives them the same
//! `window.electronAPI` / `window.desktopAPI` the Electron preload did.

mod app;
mod displays;
mod host;
mod ipc;
#[cfg(windows)]
mod win32;

use app::App;
use screenping_core::settings::PRODUCTION_SERVER_URL;
use screenping_core::{SecretBox, SettingsStore};
use std::sync::Arc;
use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

pub(crate) fn apply_autostart(handle: &tauri::AppHandle, enabled: bool) {
    // Only installed builds register at login (Electron: app.isPackaged).
    if cfg!(debug_assertions) {
        return;
    }
    let launcher = handle.autolaunch();
    let _ = if enabled { launcher.enable() } else { launcher.disable() };
}

fn secret_box() -> Arc<dyn SecretBox> {
    #[cfg(windows)]
    return Arc::new(win32::DpapiSecretBox);
    #[cfg(not(windows))]
    Arc::new(screenping_core::settings::PlainSecretBox)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|handle, _argv, _cwd| {
            if let Some(app) = handle.try_state::<Arc<App>>() {
                app.second_instance();
            }
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![ipc::ipc_invoke, ipc::ipc_send])
        .setup(|tauri_app| {
            let handle = tauri_app.handle().clone();
            let dir = handle.path().app_config_dir()?;
            let store = SettingsStore::load(dir.join("settings.json"), secret_box());

            // Installed builds always use production; dev builds may point
            // elsewhere (Electron's USE_LOCAL_SERVER flag).
            let server = std::env::var("SCREENPING_SERVER_URL")
                .ok()
                .filter(|_| cfg!(debug_assertions))
                .unwrap_or_else(|| PRODUCTION_SERVER_URL.to_string());
            store.update(|s| s.server_url = server);

            let version = handle.package_info().version.to_string();
            // The core spawns tokio tasks: enter Tauri's runtime.
            let _guard = tauri::async_runtime::handle().inner().enter();
            let app = App::new(handle.clone(), store.clone(), version);
            tauri_app.manage(app.clone());

            apply_autostart(&handle, store.get().launch_at_login);
            app.create_overlay_windows()?;
            tauri::async_runtime::spawn(app.clone().bootstrap());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Screen Ping")
        .run(|_handle, event| {
            // Keep running in the tray when windows close; "Quit" calls exit().
            if let RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        });
}
