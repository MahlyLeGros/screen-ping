//! HTTP API: session (auth.ts, windows.ts refreshAccessToken) and
//! authenticated calls (apiClient.ts).

use crate::settings::SettingsStore;
use reqwest::{multipart, Method, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Debug, Clone)]
pub struct ApiError {
    pub message: String,
    pub status: Option<u16>,
}

impl ApiError {
    pub fn new(message: impl Into<String>, status: Option<u16>) -> Self {
        Self { message: message.into(), status }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<reqwest::Error> for ApiError {
    fn from(e: reqwest::Error) -> Self {
        ApiError::new(format!("fetch failed: {e}"), None)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefreshResult {
    Ok(String),
    NoRefresh,
    Unauthorized,
    Network,
}

impl RefreshResult {
    pub fn is_ok(&self) -> bool {
        matches!(self, RefreshResult::Ok(_))
    }
}

type ExpiredHandler = Arc<dyn Fn() + Send + Sync>;

#[derive(Clone)]
pub struct Api {
    http: reqwest::Client,
    pub store: SettingsStore,
    refresh_lock: Arc<AsyncMutex<()>>,
    on_session_expired: Arc<Mutex<Option<ExpiredHandler>>>,
    browser_login_cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

const RESTORE_RETRY_DELAYS_MS: [u64; 7] = [400, 800, 1500, 2500, 4000, 6000, 8000];

async fn read_error(res: reqwest::Response, fallback: &str) -> String {
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    match body.get("detail") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => o
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or(fallback)
            .to_string(),
        Some(Value::Array(a)) => a
            .first()
            .and_then(|d| d.get("msg"))
            .and_then(Value::as_str)
            .unwrap_or(fallback)
            .to_string(),
        _ => {
            if fallback.is_empty() {
                status.canonical_reason().unwrap_or("Request failed").to_string()
            } else {
                fallback.to_string()
            }
        }
    }
}

impl Api {
    pub fn new(store: SettingsStore, app_version: &str) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(format!("ScreenPing-Desktop/{app_version}"))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("http client");
        Self {
            http,
            store,
            refresh_lock: Arc::new(AsyncMutex::new(())),
            on_session_expired: Arc::new(Mutex::new(None)),
            browser_login_cancel: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_session_expired_handler(&self, f: impl Fn() + Send + Sync + 'static) {
        *self.on_session_expired.lock().unwrap() = Some(Arc::new(f));
    }

    fn session_expired(&self) {
        let handler = self.on_session_expired.lock().unwrap().clone();
        if let Some(h) = handler {
            h();
        }
    }

    fn base(&self) -> String {
        self.store.server_url()
    }

    // ----- session -------------------------------------------------------

    /// Single-flight refresh, like `refreshAccessToken` in windows.ts.
    pub async fn refresh_access_token(&self) -> RefreshResult {
        let before = self.store.access_token();
        let _guard = self.refresh_lock.lock().await;
        // Another caller refreshed while we waited.
        if let Some(now) = self.store.access_token() {
            if before.as_deref() != Some(now.as_str()) {
                return RefreshResult::Ok(now);
            }
        }
        let Some(refresh) = self.store.refresh_token() else {
            return RefreshResult::NoRefresh;
        };
        let res = self
            .http
            .post(format!("{}/api/auth/refresh", self.base()))
            .header("X-ScreenPing-Client", "desktop")
            .timeout(Duration::from_secs(20))
            .json(&json!({ "refresh_token": refresh }))
            .send()
            .await;
        let Ok(res) = res else { return RefreshResult::Network };
        if res.status() == StatusCode::UNAUTHORIZED || res.status() == StatusCode::FORBIDDEN {
            return RefreshResult::Unauthorized;
        }
        if !res.status().is_success() {
            return RefreshResult::Network;
        }
        let Ok(data) = res.json::<Value>().await else { return RefreshResult::Network };
        let Some(access) = data.get("access_token").and_then(Value::as_str) else {
            return RefreshResult::Network;
        };
        self.store.update(|s| s.access_token = Some(access.to_string()));
        if let Some(r) = data.get("refresh_token").and_then(Value::as_str) {
            let _ = self.store.set_refresh_token(Some(r));
        }
        RefreshResult::Ok(access.to_string())
    }

    async fn refresh_with_retry(&self) -> RefreshResult {
        let mut last = self.refresh_access_token().await;
        if last != RefreshResult::Network {
            return last;
        }
        for delay in RESTORE_RETRY_DELAYS_MS {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            last = self.refresh_access_token().await;
            if last != RefreshResult::Network {
                return last;
            }
        }
        last
    }

    /// `tryRestoreSession` from auth.ts.
    pub async fn try_restore_session(&self) -> bool {
        let has_access = self.store.access_token().is_some();
        if !has_access && self.store.refresh_token().is_none() {
            return false;
        }
        match self.refresh_with_retry().await {
            RefreshResult::Ok(_) => true,
            RefreshResult::Network => self.store.access_token().is_some(),
            _ => false,
        }
    }

    fn apply_session_tokens(&self, access: &str, refresh: Option<&str>, remember: bool) -> Result<(), ApiError> {
        if access.is_empty() {
            return Err(ApiError::new("Login failed", None));
        }
        self.store.update(|s| {
            s.access_token = Some(access.to_string());
            s.remember_login = remember;
            if !remember {
                s.saved_username = None;
            }
        });
        if let Some(r) = refresh {
            self.store.set_refresh_token(Some(r)).map_err(|e| ApiError::new(e, None))?;
        }
        Ok(())
    }

    pub async fn login(&self, username: &str, password: &str, remember: bool) -> Result<(), ApiError> {
        let res = self
            .http
            .post(format!("{}/api/auth/login", self.base()))
            .header("X-ScreenPing-Client", "desktop")
            .timeout(Duration::from_secs(30))
            .json(&json!({ "username": username, "password": password }))
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(ApiError::new(read_error(res, "Login failed").await, None));
        }
        let data: Value = res.json().await?;
        let access = data.get("access_token").and_then(Value::as_str).unwrap_or_default();
        self.apply_session_tokens(access, data.get("refresh_token").and_then(Value::as_str), true)?;
        // Never persist the password; the refresh token keeps the session.
        self.store.update(|s| {
            s.remember_login = remember;
            s.saved_username = if remember { Some(username.to_string()) } else { None };
        });
        Ok(())
    }

    pub fn saved_login_form(&self) -> Value {
        let s = self.store.get();
        let username = match (&s.saved_username, s.remember_login) {
            (Some(u), true) => u.clone(),
            _ => String::new(),
        };
        json!({ "username": username, "password": "", "remember": true })
    }

    pub fn clear_login_credentials(&self) {
        self.store.update(|s| {
            s.saved_username = None;
            s.remember_login = false;
        });
    }

    pub async fn revoke_current_session(&self) {
        let Some(refresh) = self.store.refresh_token() else { return };
        let _ = self
            .http
            .post(format!("{}/api/auth/logout", self.base()))
            .header("X-ScreenPing-Client", "desktop")
            .timeout(Duration::from_secs(5))
            .json(&json!({ "refresh_token": refresh }))
            .send()
            .await;
    }

    pub fn cancel_browser_login(&self) {
        if let Some(flag) = self.browser_login_cancel.lock().unwrap().take() {
            flag.store(true, Ordering::SeqCst);
        }
    }

    /// `loginViaBrowser`: `open_url` opens the system browser.
    pub async fn login_via_browser(
        &self,
        google: bool,
        remember: bool,
        open_url: impl FnOnce(String),
    ) -> Result<(), ApiError> {
        self.cancel_browser_login();
        let cancel = Arc::new(AtomicBool::new(false));
        *self.browser_login_cancel.lock().unwrap() = Some(cancel.clone());
        let cancelled = || ApiError::new("Cancelled", None);

        let base = self.base();
        let started = self
            .http
            .post(format!("{base}/api/auth/desktop-link/start"))
            .timeout(Duration::from_secs(20))
            .json(&json!({}))
            .send()
            .await?;
        if !started.status().is_success() {
            return Err(ApiError::new(read_error(started, "Could not start website login").await, None));
        }
        #[derive(Deserialize)]
        struct Start {
            pairing_id: String,
            poll_secret: String,
            expires_in: Option<u64>,
        }
        let session: Start = started.json().await?;
        let link_path = format!("/link-desktop?pairing={}", urlencode(&session.pairing_id));
        let url = if google {
            format!("{base}/login?next={}", urlencode(&link_path))
        } else {
            format!("{base}{link_path}")
        };
        open_url(url);

        let deadline = Instant::now() + Duration::from_secs(session.expires_in.unwrap_or(300).max(30));
        loop {
            for _ in 0..15 {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            if cancel.load(Ordering::SeqCst) {
                return Err(cancelled());
            }
            if Instant::now() > deadline {
                return Err(ApiError::new("Website login timed out. Try again.", None));
            }
            let polled = self
                .http
                .post(format!("{base}/api/auth/desktop-link/poll"))
                .timeout(Duration::from_secs(20))
                .json(&json!({ "pairing_id": session.pairing_id, "poll_secret": session.poll_secret }))
                .send()
                .await?;
            if !polled.status().is_success() {
                return Err(ApiError::new(read_error(polled, "Website login failed").await, None));
            }
            let r: Value = polled.json().await?;
            match r.get("status").and_then(Value::as_str).unwrap_or("") {
                "pending" => continue,
                "denied" => return Err(ApiError::new("Website login was denied.", None)),
                "expired" => return Err(ApiError::new("Website login expired. Try again.", None)),
                "ready" => {
                    let access = r.get("access_token").and_then(Value::as_str);
                    let refresh = r.get("refresh_token").and_then(Value::as_str);
                    if let (Some(a), Some(rt)) = (access, refresh) {
                        self.apply_session_tokens(a, Some(rt), remember)?;
                        return Ok(());
                    }
                    return Err(ApiError::new("Website login failed", None));
                }
                _ => return Err(ApiError::new("Website login failed", None)),
            }
        }
    }

    // ----- authenticated calls (apiClient.ts) ----------------------------

    async fn api_fetch(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        form: Option<impl Fn() -> Result<multipart::Form, ApiError>>,
    ) -> Result<reqwest::Response, ApiError> {
        for attempt in 0..2 {
            let Some(token) = self.store.access_token() else {
                self.session_expired();
                return Err(ApiError::new("Not logged in", Some(401)));
            };
            let mut req = self
                .http
                .request(method.clone(), format!("{}{}", self.base(), path))
                .bearer_auth(token);
            if let Some(b) = &body {
                req = req.json(b);
            }
            if let Some(f) = &form {
                req = req.multipart(f()?).timeout(Duration::from_secs(600));
            } else {
                req = req.timeout(Duration::from_secs(30));
            }
            let res = req.send().await?;
            if res.status() != StatusCode::UNAUTHORIZED {
                return Ok(res);
            }
            if attempt == 1 {
                break;
            }
            match self.refresh_access_token().await {
                RefreshResult::Ok(_) => continue,
                RefreshResult::Unauthorized => {
                    self.session_expired();
                    return Err(ApiError::new("Session expired", Some(401)));
                }
                _ => return Err(ApiError::new("Session expired", Some(401))),
            }
        }
        self.session_expired();
        Err(ApiError::new("Session expired", Some(401)))
    }

    async fn api_json(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value, ApiError> {
        let res = self
            .api_fetch(method, path, body, None::<fn() -> Result<multipart::Form, ApiError>>)
            .await?;
        let status = res.status();
        if !status.is_success() {
            return Err(ApiError::new(read_error(res, "").await, Some(status.as_u16())));
        }
        if status == StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        Ok(res.json().await?)
    }

    pub async fn fetch_me(&self) -> Result<Value, ApiError> {
        self.api_json(Method::GET, "/api/auth/me", None).await
    }

    pub async fn list_friends(&self) -> Result<Value, ApiError> {
        self.api_json(Method::GET, "/api/friends", None).await
    }

    pub async fn request_friend(&self, username: &str) -> Result<Value, ApiError> {
        self.api_json(Method::POST, "/api/friends/request", Some(json!({ "username": username }))).await
    }

    /// accept / decline / remove / block / unblock
    pub async fn friend_action(&self, id: &str, action: &str) -> Result<Value, ApiError> {
        if !matches!(action, "accept" | "decline" | "remove" | "block" | "unblock") {
            return Err(ApiError::new("Unknown friend action", None));
        }
        self.api_json(Method::POST, &format!("/api/friends/{}/{action}", urlencode(id)), None).await
    }

    pub async fn upload_media(
        &self,
        receiver_ids: &[String],
        file_path: &str,
        caption: Option<&str>,
        sound_path: Option<&str>,
    ) -> Result<Value, ApiError> {
        if receiver_ids.is_empty() {
            return Err(ApiError::new("Select at least one friend", None));
        }
        let mut path = format!("/api/media/upload?receiver_ids={}", urlencode(&receiver_ids.join(",")));
        if let Some(c) = caption.map(str::trim).filter(|c| !c.is_empty()) {
            path.push_str(&format!("&caption={}", urlencode(c)));
        }
        let main = read_part(file_path)?;
        let sound = sound_path.map(read_part).transpose()?;
        let build = move || -> Result<multipart::Form, ApiError> {
            let mut form = multipart::Form::new().part("file", main.to_part());
            if let Some(s) = &sound {
                form = form.part("sound_file", s.to_part());
            }
            Ok(form)
        };
        let res = self.api_fetch(Method::POST, &path, None, Some(build)).await?;
        let status = res.status();
        if !status.is_success() {
            return Err(ApiError::new(read_error(res, "").await, Some(status.as_u16())));
        }
        let data: Value = res.json().await?;
        Ok(data.get("uploads").cloned().unwrap_or(Value::Array(vec![])))
    }
}

struct FilePart {
    name: String,
    bytes: bytes_shim::Bytes,
}

impl FilePart {
    fn to_part(&self) -> multipart::Part {
        multipart::Part::bytes(self.bytes.to_vec()).file_name(self.name.clone())
    }
}

mod bytes_shim {
    pub type Bytes = std::sync::Arc<Vec<u8>>;
}

fn read_part(file_path: &str) -> Result<FilePart, ApiError> {
    let bytes = std::fs::read(file_path).map_err(|e| ApiError::new(format!("Cannot read file: {e}"), None))?;
    let name = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    Ok(FilePart { name, bytes: std::sync::Arc::new(bytes) })
}

pub fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
