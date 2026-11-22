//! Persistent settings, ported from desktop/main/store.ts.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

pub const PRODUCTION_SERVER_URL: &str = "https://screenping.xyz";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub access_token: Option<String>,
    /// Sealed with the platform `SecretBox` (DPAPI on Windows).
    pub refresh_token: Option<String>,
    pub server_url: String,
    pub paused: bool,
    /// 0..=1, applied to pings in the overlay.
    pub receive_volume: f64,
    pub online: bool,
    pub overlay_display_id: Option<u32>,
    pub saved_username: Option<String>,
    pub remember_login: bool,
    pub launch_at_login: bool,
    pub launch_at_login_defaulted: bool,
    pub always_on_top: bool,
    pub compact: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            access_token: None,
            refresh_token: None,
            server_url: PRODUCTION_SERVER_URL.to_string(),
            paused: false,
            receive_volume: 1.0,
            online: true,
            overlay_display_id: None,
            saved_username: None,
            remember_login: true,
            launch_at_login: true,
            launch_at_login_defaulted: false,
            always_on_top: false,
            compact: false,
        }
    }
}

/// Encrypts secrets at rest (refresh token). Windows uses DPAPI.
pub trait SecretBox: Send + Sync {
    fn seal(&self, plain: &str) -> Result<String, String>;
    fn open(&self, sealed: &str) -> Result<String, String>;
}

/// No encryption. Only for tests and non-Windows dev builds.
pub struct PlainSecretBox;
impl SecretBox for PlainSecretBox {
    fn seal(&self, plain: &str) -> Result<String, String> {
        Ok(plain.to_string())
    }
    fn open(&self, sealed: &str) -> Result<String, String> {
        Ok(sealed.to_string())
    }
}

#[derive(Clone)]
pub struct SettingsStore {
    inner: Arc<Mutex<Settings>>,
    path: Option<Arc<PathBuf>>,
    secrets: Arc<dyn SecretBox>,
}

impl SettingsStore {
    /// Load from `path` (or defaults when missing/corrupt).
    pub fn load(path: PathBuf, secrets: Arc<dyn SecretBox>) -> Self {
        let settings = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .unwrap_or_default();
        let store = Self {
            inner: Arc::new(Mutex::new(settings)),
            path: Some(Arc::new(path)),
            secrets,
        };
        store.apply_launch_at_login_default();
        store
    }

    pub fn in_memory(settings: Settings, secrets: Arc<dyn SecretBox>) -> Self {
        Self { inner: Arc::new(Mutex::new(settings)), path: None, secrets }
    }

    fn lock(&self) -> MutexGuard<'_, Settings> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn get(&self) -> Settings {
        self.lock().clone()
    }

    /// Mutate and persist.
    pub fn update<R>(&self, f: impl FnOnce(&mut Settings) -> R) -> R {
        let (r, snapshot) = {
            let mut s = self.lock();
            let r = f(&mut s);
            (r, s.clone())
        };
        self.save(&snapshot);
        r
    }

    fn save(&self, s: &Settings) {
        let Some(path) = &self.path else { return };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(s) {
            let tmp = path.with_extension("json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, path.as_ref());
            }
        }
    }

    /// Same one-time flip as store.ts `applyLaunchAtLoginDefault`.
    fn apply_launch_at_login_default(&self) {
        if self.get().launch_at_login_defaulted {
            return;
        }
        self.update(|s| {
            s.launch_at_login = true;
            s.launch_at_login_defaulted = true;
        });
    }

    pub fn server_url(&self) -> String {
        self.lock().server_url.trim().trim_end_matches('/').to_string()
    }

    pub fn access_token(&self) -> Option<String> {
        self.lock().access_token.clone()
    }

    pub fn set_refresh_token(&self, value: Option<&str>) -> Result<(), String> {
        let sealed = match value {
            Some(v) if !v.is_empty() => Some(self.secrets.seal(v)?),
            _ => None,
        };
        self.update(|s| s.refresh_token = sealed);
        Ok(())
    }

    pub fn refresh_token(&self) -> Option<String> {
        let sealed = self.lock().refresh_token.clone()?;
        match self.secrets.open(&sealed) {
            Ok(v) => Some(v),
            Err(_) => {
                self.update(|s| s.refresh_token = None);
                None
            }
        }
    }

    pub fn clear_session_tokens(&self) {
        self.update(|s| {
            s.access_token = None;
            s.refresh_token = None;
        });
    }
}
