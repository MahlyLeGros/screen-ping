//! Monitors: stable ids, labels for the settings UI, overlay target.

use screenping_core::displays::{label_displays, Bounds, DisplayLike, LabeledDisplay};
use tauri::{AppHandle, Monitor};

/// Stable id from the monitor's device name (FNV-1a).
pub fn monitor_id(m: &Monitor) -> u32 {
    let name = m.name().cloned().unwrap_or_default();
    let mut h: u32 = 0x811c9dc5;
    for b in name.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

/// Logical (DIP) bounds, like Electron's `Display.bounds`.
fn logical_bounds(m: &Monitor) -> Bounds {
    let s = m.scale_factor().max(0.1);
    Bounds {
        x: (m.position().x as f64 / s).round() as i32,
        y: (m.position().y as f64 / s).round() as i32,
        width: (m.size().width as f64 / s).round() as i32,
        height: (m.size().height as f64 / s).round() as i32,
    }
}

pub fn list(app: &AppHandle) -> Vec<LabeledDisplay> {
    let monitors = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten().map(|m| monitor_id(&m));
    let like: Vec<DisplayLike> =
        monitors.iter().map(|m| DisplayLike { id: monitor_id(m), bounds: logical_bounds(m) }).collect();
    label_displays(&like, primary)
}

/// Saved monitor, else the primary one.
pub fn overlay_monitor(app: &AppHandle, saved: Option<u32>) -> Option<Monitor> {
    if let Some(id) = saved {
        if let Some(m) = app.available_monitors().ok()?.into_iter().find(|m| monitor_id(m) == id) {
            return Some(m);
        }
    }
    app.primary_monitor().ok().flatten()
}
