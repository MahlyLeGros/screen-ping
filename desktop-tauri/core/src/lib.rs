//! Screen Ping desktop receiver core, with no UI dependency.
//!
//! Ported from `desktop/main/*.ts` (Electron main process):
//! - `settings` ← store.ts
//! - `api`      ← auth.ts, apiClient.ts, windows.ts (refreshAccessToken)
//! - `socket`   ← socketClient.ts
//! - `overlay`  ← overlayQueue.ts + drawOverlay.ts
//! - `displays` ← displayLayout.ts
//!
//! The Tauri app supplies the platform pieces through small traits
//! (`SecretBox`, `SocketEvents`, `OverlayHost`, `QueueOutput`).

pub mod api;
pub mod displays;
pub mod overlay;
pub mod settings;
pub mod socket;

pub use api::{Api, ApiError, RefreshResult};
pub use settings::{SecretBox, Settings, SettingsStore};

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
