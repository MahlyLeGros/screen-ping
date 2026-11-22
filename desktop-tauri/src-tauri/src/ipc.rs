//! The two commands behind the bridge (bridge.js): the same channel names
//! the Electron preload used with ipcRenderer.invoke / ipcRenderer.send.

use crate::app::{App, LOGIN, MAIN, MENU};
use crate::host::OVERLAY;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

fn str_arg(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

fn id_arg(v: &Value) -> Result<String, String> {
    v.as_str().map(String::from).ok_or_else(|| "Missing id".to_string())
}

async fn pick(app: &App, title: &str, filters: Vec<(&'static str, Vec<&'static str>)>) -> Value {
    let mut dialog = app.handle.dialog().file().set_title(title);
    for (name, exts) in filters {
        dialog = dialog.add_filter(name, &exts);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file()).await;
    match picked.ok().flatten().and_then(|p| p.into_path().ok()) {
        Some(p) => json!(p.to_string_lossy()),
        None => Value::Null,
    }
}

#[tauri::command]
pub async fn ipc_invoke(
    window: WebviewWindow,
    state: State<'_, Arc<App>>,
    channel: String,
    payload: Value,
) -> Result<Value, String> {
    let app = state.inner().clone();
    let err = |e: screenping_core::ApiError| e.message;
    let label = window.label().to_string();
    let from_ui = label == LOGIN || label == MAIN || label == MENU;
    if !from_ui {
        return Err("Not allowed from this window".into());
    }
    match channel.as_str() {
        "auth:get-saved-login" => Ok(app.api.saved_login_form()),
        "auth:login" => {
            let user = str_arg(&payload, "username").unwrap_or_default();
            let pass = str_arg(&payload, "password").unwrap_or_default();
            let remember = payload.get("remember").and_then(Value::as_bool) != Some(false);
            app.api.login(user.trim(), &pass, remember).await.map_err(err)?;
            app.after_login();
            Ok(json!({ "ok": true }))
        }
        "auth:browser-login" => {
            let google = str_arg(&payload, "mode").as_deref() == Some("google");
            let remember = payload.get("remember").and_then(Value::as_bool) != Some(false);
            let opener = app.clone();
            app.api
                .login_via_browser(google, remember, move |url| opener.open_browser(url))
                .await
                .map_err(err)?;
            app.after_login();
            Ok(json!({ "ok": true }))
        }
        "auth:cancel-browser-login" => {
            app.api.cancel_browser_login();
            Ok(json!({ "ok": true }))
        }
        "app:get-state" => Ok(app.state()),
        "friends:list" => app.api.list_friends().await.map_err(err),
        "friends:request" => {
            let username = payload.as_str().unwrap_or_default().to_string();
            app.api.request_friend(&username).await.map_err(err)
        }
        "friends:accept" | "friends:decline" | "friends:remove" | "friends:block" | "friends:unblock" => {
            let action = channel.trim_start_matches("friends:");
            app.api.friend_action(&id_arg(&payload)?, action).await.map_err(err)
        }
        "media:upload" => {
            let receivers: Vec<String> = payload
                .get("receiverIds")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let file = str_arg(&payload, "filePath").ok_or("Missing file")?;
            let caption = str_arg(&payload, "caption");
            let sound = str_arg(&payload, "soundPath");
            app.api
                .upload_media(&receivers, &file, caption.as_deref(), sound.as_deref())
                .await
                .map_err(err)
        }
        "message:send" => {
            app.socket.send_message(&payload).await?;
            Ok(json!({ "ok": true }))
        }
        "dialog:pick-media" => Ok(pick(
            &app,
            "Choose image, video, or audio",
            vec![
                ("Media", vec!["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a"]),
                ("Images", vec!["png", "jpg", "jpeg", "gif", "webp"]),
                ("Videos", vec!["mp4", "webm", "mov"]),
                ("Audio", vec!["mp3", "wav", "ogg", "m4a"]),
            ],
        )
        .await),
        "dialog:pick-audio" => Ok(pick(
            &app,
            "Choose sound file",
            vec![("Audio", vec!["mp3", "wav", "ogg", "m4a", "aac"])],
        )
        .await),
        other => Err(format!("Unknown channel {other}")),
    }
}

#[tauri::command]
pub async fn ipc_send(window: WebviewWindow, state: State<'_, Arc<App>>, channel: String, payload: Value) -> Result<(), ()> {
    let app = state.inner().clone();
    let label = window.label().to_string();
    let from_overlay = label == OVERLAY;
    let message_id = || str_arg(&payload, "messageId");

    match channel.as_str() {
        // Overlay renderer only.
        "overlay:initialized" if from_overlay => app.overlay_initialized(),
        "overlay:ready" if from_overlay => {
            if let Some(id) = message_id() {
                app.queue.overlay_ready(id);
            }
        }
        "overlay:failed" if from_overlay => {
            if let Some(id) = message_id() {
                app.queue.overlay_failed(id);
            }
        }
        "overlay:dismiss" if from_overlay => app.queue.dismiss_current(),
        "overlay:cleared" if from_overlay => app.host.cleared.notify_waiters(),
        "draw:idle" if from_overlay => app.queue.draw_idle(),

        "app:set" if !from_overlay => {
            if let Some(key) = payload.get("key").and_then(Value::as_str) {
                let value = payload.get("value").cloned().unwrap_or(Value::Null);
                app.apply_setting(key, &value);
            }
        }
        "app:action" if !from_overlay => {
            if let Some(name) = payload.as_str() {
                app.run_action(name).await;
            }
        }
        "win:minimize" if !from_overlay => {
            let _ = window.minimize();
        }
        "win:close" if !from_overlay => {
            let _ = window.close();
        }
        "win:resize-content" if label == MAIN => {
            if let Some(h) = payload.as_f64() {
                app.resize_to_content(&window, h);
            }
        }
        "menu:resize" if label == MENU => {
            let w = payload.get("width").and_then(Value::as_f64).unwrap_or(278.0);
            let h = payload.get("height").and_then(Value::as_f64).unwrap_or(0.0);
            app.resize_menu(w, h);
        }
        "menu:hide" if label == MENU => app.hide_menu(),
        _ => {}
    }
    Ok(())
}
