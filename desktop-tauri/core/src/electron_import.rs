//! Take over the Electron app's settings and login on first launch, so moving
//! to this app keeps people signed in.
//!
//! Electron kept `config.json` (electron-store) in
//! `%APPDATA%\screen-ping-desktop` (desktop/main/userData.ts). Its field names
//! match [`Settings`]. The refresh token is `enc:v1:` + base64 of an Electron
//! `safeStorage` blob: Chromium's OSCrypt format, `v10` + 12-byte nonce +
//! AES-256-GCM ciphertext and tag. The AES key sits in the same folder's
//! `Local State` as `os_crypt.encrypted_key`: base64 of `DPAPI` + a DPAPI
//! blob, which only the same Windows user can open. The platform layer does
//! the DPAPI part; everything else is here.

use crate::settings::Settings;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use serde_json::Value;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
const SECRET_PREFIX: &str = "enc:v1:";

pub struct ElectronConfig {
    /// Everything but the tokens (and the server URL, which the app sets).
    pub settings: Settings,
    pub access_token: Option<String>,
    pub refresh_token: Option<RefreshToken>,
}

pub enum RefreshToken {
    /// Releases before 1.0.62 stored it as is.
    Plain(String),
    /// A `safeStorage` blob.
    Sealed(Vec<u8>),
}

impl ElectronConfig {
    pub fn has_session(&self) -> bool {
        self.refresh_token.is_some() || self.access_token.is_some()
    }
}

pub fn parse_config(text: &str) -> Option<ElectronConfig> {
    let raw: Value = serde_json::from_str(text).ok()?;
    if !raw.is_object() {
        return None;
    }
    let mut settings: Settings = serde_json::from_value(raw.clone()).unwrap_or_default();
    settings.access_token = None;
    settings.refresh_token = None;
    let str_of = |k: &str| raw.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from);
    let refresh_token = str_of("refreshToken").map(|t| match t.strip_prefix(SECRET_PREFIX) {
        Some(b64) => RefreshToken::Sealed(B64.decode(b64).unwrap_or_default()),
        None => RefreshToken::Plain(t),
    });
    Some(ElectronConfig { settings, access_token: str_of("accessToken"), refresh_token })
}

/// `os_crypt.encrypted_key` from `Local State`, without its `DPAPI` prefix:
/// what CryptUnprotectData has to open.
pub fn local_state_key_blob(local_state: &str) -> Option<Vec<u8>> {
    let v: Value = serde_json::from_str(local_state).ok()?;
    let b64 = v.get("os_crypt")?.get("encrypted_key")?.as_str()?;
    let blob = B64.decode(b64).ok()?;
    blob.strip_prefix(b"DPAPI").map(<[u8]>::to_vec)
}

/// Open a `safeStorage` blob with the AES key from `Local State`.
pub fn open_safe_storage(key: &[u8], blob: &[u8]) -> Option<String> {
    let body = blob.strip_prefix(b"v10")?;
    if body.len() < 12 + 16 || key.len() != 32 {
        return None;
    }
    let (nonce, ciphertext) = body.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let plain = cipher.decrypt(Nonce::from_slice(nonce), ciphertext).ok()?;
    String::from_utf8(plain).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_chromium_v10_blobs() {
        let key = [7u8; 32];
        let nonce = [3u8; 12];
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let ct = cipher.encrypt(Nonce::from_slice(&nonce), b"refresh-123".as_ref()).unwrap();
        let blob = [b"v10".as_ref(), &nonce, &ct].concat();
        assert_eq!(open_safe_storage(&key, &blob).as_deref(), Some("refresh-123"));
        assert_eq!(open_safe_storage(&[8u8; 32], &blob), None);
        assert_eq!(open_safe_storage(&key, b"v11garbage"), None);
    }

    #[test]
    fn reads_the_electron_config() {
        let text = r#"{
            "accessToken": "acc",
            "refreshToken": "enc:v1:djEwAAAA",
            "serverUrl": "https://screenping.xyz",
            "receiveVolume": 0.4,
            "online": false,
            "overlayDisplayId": 123,
            "savedUsername": "mali",
            "savedPasswordEnc": null,
            "launchAtLogin": false,
            "launchAtLoginDefaulted": true,
            "compact": true
        }"#;
        let c = parse_config(text).unwrap();
        assert!(c.has_session());
        assert_eq!(c.access_token.as_deref(), Some("acc"));
        assert!(matches!(c.refresh_token, Some(RefreshToken::Sealed(ref b)) if b.starts_with(b"v10")));
        assert_eq!(c.settings.receive_volume, 0.4);
        assert_eq!(c.settings.overlay_display_id, Some(123));
        assert_eq!(c.settings.saved_username.as_deref(), Some("mali"));
        assert!(!c.settings.launch_at_login && c.settings.launch_at_login_defaulted && c.settings.compact);
        assert!(c.settings.refresh_token.is_none() && c.settings.access_token.is_none());

        let plain = parse_config(r#"{"refreshToken":"abc"}"#).unwrap();
        assert!(matches!(plain.refresh_token, Some(RefreshToken::Plain(ref t)) if t == "abc"));
        assert!(!parse_config(r#"{"serverUrl":"x"}"#).unwrap().has_session());
        assert!(parse_config("not json").is_none());
    }

    #[test]
    fn reads_the_local_state_key() {
        let blob = B64.encode([b"DPAPI".as_ref(), &[1, 2, 3]].concat());
        let ls = format!(r#"{{"os_crypt":{{"encrypted_key":"{blob}"}}}}"#);
        assert_eq!(local_state_key_blob(&ls), Some(vec![1, 2, 3]));
        assert_eq!(local_state_key_blob("{}"), None);
    }
}
