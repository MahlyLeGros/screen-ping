//! First launch after the Electron app: take over its settings and login.
//! The installer hook (nsis/hooks.nsh) has already uninstalled Electron, but
//! it keeps `%APPDATA%\screen-ping-desktop`, which is read here once.

use screenping_core::electron_import::{self, RefreshToken};
use screenping_core::SettingsStore;
use std::path::{Path, PathBuf};

const SENTINEL: &str = ".electron-imported";

fn electron_dir() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("APPDATA")?).join("screen-ping-desktop"))
}

/// Runs once per install. Never overwrites a session this app already has.
pub fn import_from_electron(store: &SettingsStore, config_dir: &Path) {
    let sentinel = config_dir.join(SENTINEL);
    if sentinel.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(config_dir);
    let _ = std::fs::write(&sentinel, "1");

    crate::win32::remove_electron_autostart();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        // electron-updater's download cache.
        let _ = std::fs::remove_dir_all(PathBuf::from(local).join("screen-ping-desktop-updater"));
    }

    if store.refresh_token().is_some() {
        return;
    }
    let Some(dir) = electron_dir() else { return };
    let Some(config) = std::fs::read_to_string(dir.join("config.json"))
        .ok()
        .and_then(|t| electron_import::parse_config(&t))
    else {
        return;
    };

    let refresh = match &config.refresh_token {
        Some(RefreshToken::Plain(t)) => Some(t.clone()),
        Some(RefreshToken::Sealed(blob)) => std::fs::read_to_string(dir.join("Local State"))
            .ok()
            .and_then(|ls| electron_import::local_state_key_blob(&ls))
            .and_then(|k| crate::win32::dpapi_unprotect(&k).ok())
            .and_then(|key| electron_import::open_safe_storage(&key, blob)),
        None => None,
    };

    let imported = config.settings;
    store.update(|s| {
        // Server URL stays the one this build uses.
        let server = std::mem::take(&mut s.server_url);
        *s = imported;
        s.server_url = server;
        // Without a refresh token the access token expires soon anyway, but it
        // lets the first launch connect while the refresh is attempted.
        s.access_token = config.access_token.clone();
        s.refresh_token = None;
        // Electron's update hand-off always comes back online.
        s.online = true;
    });
    if let Some(token) = refresh {
        let _ = store.set_refresh_token(Some(&token));
    }
}
