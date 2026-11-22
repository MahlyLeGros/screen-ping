//! Auto-update, ported from updater.ts / updateFeed.ts / updateSignature.ts /
//! versionCheck.ts. Same server contract as the Electron app, so one
//! published installer serves both:
//!
//! 1. `GET {server}/api/desktop/next?from={version}` names the target and its
//!    feed folder (`/desktop/updates/v/{version}/`).
//! 2. `{feed}/latest.yml` (electron-builder format) gives the installer URL and
//!    its SHA-512.
//! 3. `{server}/desktop/updates/{installer}.sig` is an Ed25519 signature of
//!    that SHA-512 digest, made with `desktop/scripts/sign-update.js`.
//!
//! The installer only runs when both the hash and the signature match.

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha512};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::io::AsyncWriteExt;

/// `desktop/main/updatePublicKey.ts` (SPKI DER, base64). Never rotate without
/// first shipping a client that trusts both keys.
pub const UPDATE_PUBLIC_KEY_SPKI: &str = "MCowBQYDK2VwAyEA456Jh+SGvfX68bpkqu2/Rr/8VApwQNQ8UWa2bYNdCp8=";

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// Same shape as Electron's `UpdateStatus`, which the update window renders.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum UpdateStatus {
    Idle,
    Checking,
    Available { version: String },
    Downloading { percent: f64, transferred: u64, total: u64, bytes_per_second: f64 },
    Ready { version: String },
    Installing { version: String },
    UpToDate,
    Error { message: String },
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct NextInfo {
    #[serde(default)]
    pub next: Option<String>,
    #[serde(default)]
    pub latest: Option<String>,
    #[serde(default)]
    pub feed_url: Option<String>,
    #[serde(default)]
    pub download_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FeedEntry {
    pub version: String,
    pub url: String,
    /// Base64 SHA-512, as electron-updater expects it.
    pub sha512: String,
    pub size: Option<u64>,
}

pub fn parse_version(v: &str) -> (u64, u64, u64) {
    let mut it = v.trim().trim_start_matches(['v', 'V']).split('.').map(|p| {
        p.chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0)
    });
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    parse_version(candidate) > parse_version(current)
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches(|c| c == '\'' || c == '"').to_string()
}

fn resolve(base: &str, url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }
    let base = if base.ends_with('/') { base.to_string() } else { format!("{base}/") };
    format!("{base}{}", url.split('/').map(urlencode_segment).collect::<Vec<_>>().join("/"))
}

fn urlencode_segment(s: &str) -> String {
    // Already-encoded segments stay as they are.
    if s.contains('%') {
        return s.to_string();
    }
    crate::api::urlencode(s)
}

/// The small subset of electron-builder's latest.yml we need: the first
/// `files` entry, or the top-level `path` / `sha512`.
pub fn parse_latest_yml(text: &str, feed_url: &str) -> Option<FeedEntry> {
    let mut version = None;
    let (mut top_path, mut top_sha) = (None, None);
    let (mut f_url, mut f_sha, mut f_size) = (None, None, None);
    let mut in_files = false;
    let mut first_file_done = false;
    for raw in text.lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if !indented {
            in_files = line.starts_with("files:");
            if let Some((k, v)) = line.split_once(':') {
                match k.trim() {
                    "version" => version = Some(unquote(v)),
                    "path" => top_path = Some(unquote(v)),
                    "sha512" => top_sha = Some(unquote(v)),
                    _ => {}
                }
            }
            continue;
        }
        if !in_files || first_file_done {
            continue;
        }
        let mut item = line.trim_start();
        if let Some(rest) = item.strip_prefix("- ") {
            if f_url.is_some() {
                first_file_done = true;
                continue;
            }
            item = rest;
        }
        if let Some((k, v)) = item.split_once(':') {
            match k.trim() {
                "url" => f_url = Some(unquote(v)),
                "sha512" => f_sha = Some(unquote(v)),
                "size" => f_size = unquote(v).parse().ok(),
                _ => {}
            }
        }
    }
    let (url, sha512, size) = match (f_url, f_sha) {
        (Some(u), Some(s)) => (u, s, f_size),
        _ => (top_path?, top_sha?, None),
    };
    Some(FeedEntry { version: version?, url: resolve(feed_url, &url), sha512, size })
}

/// Last URL segment, percent-decoded ("Screen Ping Setup 1.1.0.exe").
pub fn installer_name(url: &str) -> String {
    let seg = url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("");
    percent_decode(seg)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn public_key() -> Option<VerifyingKey> {
    key_from_spki(UPDATE_PUBLIC_KEY_SPKI)
}

/// An Ed25519 SPKI public key in base64 (Node's `export({type:"spki",format:"der"})`).
pub fn key_from_spki(b64: &str) -> Option<VerifyingKey> {
    let der = B64.decode(b64.trim()).ok()?;
    let raw: [u8; 32] = der.get(der.len().checked_sub(32)?..)?.try_into().ok()?;
    VerifyingKey::from_bytes(&raw).ok()
}

/// `crypto.verify(null, sha512(file), publicKey, signature)` in Node.
pub fn verify_signature_with(key: &VerifyingKey, digest: &[u8], signature_b64: &str) -> bool {
    let Ok(sig) = B64.decode(signature_b64.trim()) else { return false };
    let Ok(sig) = Signature::from_slice(&sig) else { return false };
    key.verify(digest, &sig).is_ok()
}

pub fn verify_signature(digest: &[u8], signature_b64: &str) -> bool {
    public_key().is_some_and(|k| verify_signature_with(&k, digest, signature_b64))
}

pub fn sha512_file(path: &Path) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha512::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().to_vec())
}

// ----- the update flow ----------------------------------------------------

type Listener = Box<dyn Fn(&UpdateStatus) + Send + Sync>;

struct Inner {
    status: UpdateStatus,
    next: Option<NextInfo>,
    installer: Option<PathBuf>,
    checking: bool,
}

/// One check / download / verify run at a time. Installing is the app's job
/// (it has to quit), see [`Updater::ready_installer`].
#[derive(Clone)]
pub struct Updater {
    http: reqwest::Client,
    server: Arc<dyn Fn() -> String + Send + Sync>,
    current: String,
    dir: PathBuf,
    inner: Arc<Mutex<Inner>>,
    cancel: Arc<Mutex<Arc<AtomicBool>>>,
    listener: Arc<Mutex<Option<Listener>>>,
    key: Option<VerifyingKey>,
}

impl Updater {
    /// Tests only: trust another signing key than production's.
    pub fn with_public_key(mut self, spki_b64: &str) -> Self {
        self.key = key_from_spki(spki_b64);
        self
    }

    /// `dir` holds the downloaded installer; `server` returns the API base.
    pub fn new(current: &str, dir: PathBuf, server: impl Fn() -> String + Send + Sync + 'static) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(format!("ScreenPingDesktop/{current}"))
            .build()
            .expect("http client");
        Self {
            http,
            server: Arc::new(server),
            current: current.to_string(),
            dir,
            inner: Arc::new(Mutex::new(Inner { status: UpdateStatus::Idle, next: None, installer: None, checking: false })),
            cancel: Arc::new(Mutex::new(Arc::new(AtomicBool::new(false)))),
            listener: Arc::new(Mutex::new(None)),
            key: public_key(),
        }
    }

    pub fn set_listener(&self, f: impl Fn(&UpdateStatus) + Send + Sync + 'static) {
        *self.listener.lock().unwrap() = Some(Box::new(f));
    }

    pub fn status(&self) -> UpdateStatus {
        self.inner.lock().unwrap().status.clone()
    }

    pub fn status_json(&self) -> Value {
        serde_json::to_value(self.status()).unwrap_or(Value::Null)
    }

    /// The next version the server offers, when it is newer than ours.
    pub fn outdated_target(&self) -> Option<String> {
        let inner = self.inner.lock().unwrap();
        let next = inner.next.as_ref()?.next.clone()?;
        is_newer(&next, &self.current).then_some(next)
    }

    pub fn latest_known(&self) -> Option<String> {
        let inner = self.inner.lock().unwrap();
        let n = inner.next.as_ref()?;
        n.next.clone().filter(|v| is_newer(v, &self.current)).or_else(|| n.latest.clone())
    }

    pub fn ready_installer(&self) -> Option<(String, PathBuf)> {
        let inner = self.inner.lock().unwrap();
        match (&inner.status, &inner.installer) {
            (UpdateStatus::Ready { version }, Some(p)) => Some((version.clone(), p.clone())),
            _ => None,
        }
    }

    /// Busy states the window shows a progress bar for.
    pub fn is_busy(&self) -> bool {
        matches!(
            self.status(),
            UpdateStatus::Checking | UpdateStatus::Available { .. } | UpdateStatus::Downloading { .. }
                | UpdateStatus::Ready { .. } | UpdateStatus::Installing { .. }
        )
    }

    pub fn set_status(&self, s: UpdateStatus) {
        self.inner.lock().unwrap().status = s.clone();
        if let Some(f) = self.listener.lock().unwrap().as_ref() {
            f(&s);
        }
    }

    pub fn cancel(&self) {
        self.cancel.lock().unwrap().store(true, Ordering::SeqCst);
        if matches!(
            self.status(),
            UpdateStatus::Checking | UpdateStatus::Available { .. } | UpdateStatus::Downloading { .. }
        ) {
            self.set_status(UpdateStatus::Idle);
        }
    }

    /// versionCheck.ts: refresh `outdated` / `latestVersion` only.
    pub async fn refresh_version_info(&self) -> Option<NextInfo> {
        let info = self.fetch_next().await.ok()?;
        self.inner.lock().unwrap().next = Some(info.clone());
        Some(info)
    }

    async fn fetch_next(&self) -> Result<NextInfo, String> {
        let url = format!("{}/api/desktop/next", (self.server)());
        let res = self
            .http
            .get(url)
            .query(&[("from", self.current.as_str())])
            .header("Cache-Control", "no-store")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Update server returned {}", res.status()));
        }
        res.json::<NextInfo>().await.map_err(|e| e.to_string())
    }

    async fn fetch_text(&self, url: &str) -> Result<String, String> {
        let res = self.http.get(url).header("Cache-Control", "no-store").send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("{} returned {}", url, res.status()));
        }
        res.text().await.map_err(|e| e.to_string())
    }

    /// Check, download and verify. Ends in `Ready`, `UpToDate` or `Error`
    /// (or `Idle` when cancelled). Returns true when an installer is ready.
    pub async fn check_and_download(&self) -> bool {
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.checking || matches!(inner.status, UpdateStatus::Ready { .. } | UpdateStatus::Installing { .. }) {
                return matches!(inner.status, UpdateStatus::Ready { .. });
            }
            inner.checking = true;
        }
        let token = Arc::new(AtomicBool::new(false));
        *self.cancel.lock().unwrap() = token.clone();
        let result = self.run(&token).await;
        self.inner.lock().unwrap().checking = false;
        if token.load(Ordering::SeqCst) {
            return false;
        }
        match result {
            Ok(Some((version, path))) => {
                self.inner.lock().unwrap().installer = Some(path);
                self.set_status(UpdateStatus::Ready { version });
                true
            }
            Ok(None) => {
                self.set_status(UpdateStatus::UpToDate);
                false
            }
            Err(message) => {
                self.set_status(UpdateStatus::Error { message });
                false
            }
        }
    }

    async fn run(&self, cancel: &AtomicBool) -> Result<Option<(String, PathBuf)>, String> {
        self.set_status(UpdateStatus::Checking);
        let info = self.fetch_next().await?;
        self.inner.lock().unwrap().next = Some(info.clone());
        let (Some(next), Some(feed)) = (info.next.clone(), info.feed_url.clone()) else { return Ok(None) };
        if !is_newer(&next, &self.current) {
            return Ok(None);
        }
        let feed = if feed.ends_with('/') { feed } else { format!("{feed}/") };
        let yml = self.fetch_text(&format!("{feed}latest.yml")).await?;
        let entry = parse_latest_yml(&yml, &feed).ok_or("The update feed could not be read.")?;
        if !is_newer(&entry.version, &self.current) {
            return Ok(None);
        }
        if cancel.load(Ordering::SeqCst) {
            return Ok(None);
        }
        self.set_status(UpdateStatus::Available { version: entry.version.clone() });

        let name = installer_name(&entry.url);
        if name.is_empty() || name.contains(['\\', '/', ':']) || !name.to_ascii_lowercase().ends_with(".exe") {
            return Err("The update feed names an unexpected file.".into());
        }
        let _ = std::fs::create_dir_all(&self.dir);
        let dest = self.dir.join(&name);
        self.download(&entry, &dest, cancel).await?;
        if cancel.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&dest);
            return Ok(None);
        }

        let digest = sha512_file(&dest).map_err(|e| e.to_string())?;
        if B64.encode(&digest) != entry.sha512.trim() {
            let _ = std::fs::remove_file(&dest);
            return Err("The downloaded update is corrupted (checksum mismatch).".into());
        }
        let sig_url = format!("{}/desktop/updates/{}.sig", (self.server)(), crate::api::urlencode(&name));
        let sig = self.fetch_text(&sig_url).await.map_err(|_| "Update signature is missing.".to_string())?;
        if !self.key.as_ref().is_some_and(|k| verify_signature_with(k, &digest, &sig)) {
            let _ = std::fs::remove_file(&dest);
            return Err("Update signature verification failed. The installer was not started.".into());
        }
        Ok(Some((entry.version, dest)))
    }

    async fn download(&self, entry: &FeedEntry, dest: &Path, cancel: &AtomicBool) -> Result<(), String> {
        let mut res = self.http.get(&entry.url).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Download failed ({})", res.status()));
        }
        let total = res.content_length().or(entry.size).unwrap_or(0);
        let part = dest.with_extension("exe.part");
        let mut file = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
        let started = Instant::now();
        let (mut transferred, mut last_percent) = (0u64, -1i64);
        while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
            if cancel.load(Ordering::SeqCst) {
                drop(file);
                let _ = tokio::fs::remove_file(&part).await;
                return Ok(());
            }
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            transferred += chunk.len() as u64;
            let percent = if total > 0 { transferred as f64 * 100.0 / total as f64 } else { 0.0 };
            if percent.floor() as i64 != last_percent {
                last_percent = percent.floor() as i64;
                let secs = started.elapsed().as_secs_f64().max(0.001);
                self.set_status(UpdateStatus::Downloading {
                    percent,
                    transferred,
                    total,
                    bytes_per_second: transferred as f64 / secs,
                });
            }
        }
        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);
        let _ = tokio::fs::remove_file(dest).await;
        tokio::fs::rename(&part, dest).await.map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = "version: 1.1.0
files:
  - url: https://screenping.xyz/desktop/updates/Screen%20Ping%20Setup%201.1.0.exe
    sha512: abc==
    size: 4774689
path: https://screenping.xyz/desktop/updates/Screen%20Ping%20Setup%201.1.0.exe
sha512: abc==
releaseDate: '2026-11-22T18:00:00.000Z'
";

    #[test]
    fn reads_the_feed() {
        let e = parse_latest_yml(FEED, "https://screenping.xyz/desktop/updates/v/1.1.0/").unwrap();
        assert_eq!(e.version, "1.1.0");
        assert_eq!(e.url, "https://screenping.xyz/desktop/updates/Screen%20Ping%20Setup%201.1.0.exe");
        assert_eq!(e.sha512, "abc==");
        assert_eq!(e.size, Some(4774689));
        assert_eq!(installer_name(&e.url), "Screen Ping Setup 1.1.0.exe");
    }

    #[test]
    fn resolves_relative_feed_paths() {
        // electron-builder's own latest.yml, before write-version-feed.js.
        let yml = "version: 1.0.73\nfiles:\n  - url: Screen-Ping-Setup-1.0.73.exe\n    sha512: x\n    size: 1\npath: Screen-Ping-Setup-1.0.73.exe\nsha512: x\n";
        let e = parse_latest_yml(yml, "https://h/desktop/updates/").unwrap();
        assert_eq!(e.url, "https://h/desktop/updates/Screen-Ping-Setup-1.0.73.exe");
        let yml = "version: 1.0.73\npath: Screen Ping Setup 1.0.73.exe\nsha512: y\n";
        let e = parse_latest_yml(yml, "https://h/desktop/updates").unwrap();
        assert_eq!(e.url, "https://h/desktop/updates/Screen%20Ping%20Setup%201.0.73.exe");
        assert_eq!(e.sha512, "y");
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("1.1.0", "1.0.73"));
        assert!(is_newer("1.0.74", "1.0.73"));
        assert!(!is_newer("1.0.73", "1.0.73"));
        assert!(!is_newer("1.0.9", "1.0.73"));
        assert!(is_newer("v2.0.0-beta", "1.9.9"));
    }

    #[test]
    fn status_matches_the_electron_shape() {
        let s = UpdateStatus::Downloading { percent: 50.0, transferred: 5, total: 10, bytes_per_second: 2.0 };
        assert_eq!(
            serde_json::to_value(s).unwrap(),
            serde_json::json!({"state":"downloading","percent":50.0,"transferred":5,"total":10,"bytesPerSecond":2.0})
        );
        assert_eq!(serde_json::to_value(UpdateStatus::UpToDate).unwrap(), serde_json::json!({"state":"up-to-date"}));
    }

    /// A signature made by Node's `crypto.sign(null, sha512(data), key)`,
    /// exactly as sign-update.js does (see the test key below).
    #[test]
    fn verifies_node_signatures() {
        let key_b64 = include_str!("../tests/update-test-key.txt").trim();
        let der = B64.decode(key_b64).unwrap();
        let key = VerifyingKey::from_bytes(&der[der.len() - 32..].try_into().unwrap()).unwrap();
        let digest = Sha512::digest(b"Screen Ping update test").to_vec();
        let sig = include_str!("../tests/update-test-sig.txt").trim();
        assert!(verify_signature_with(&key, &digest, sig));
        let other = Sha512::digest(b"tampered").to_vec();
        assert!(!verify_signature_with(&key, &other, sig));
        // The production key is well formed.
        assert!(public_key().is_some());
        assert!(!verify_signature(&digest, sig));
    }
}
