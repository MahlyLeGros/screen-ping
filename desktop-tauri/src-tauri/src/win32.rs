//! Win32 pieces Tauri does not expose.
//! - no-activate tool window + z-order guard (desktop/main/win32Overlay.ts)
//! - top-most keeper (overlayQueue.ts keepOverlayOnTop)
//! - idle time (Electron powerMonitor.getSystemIdleTime)
//! - DPAPI secret box (Electron safeStorage)
//! - light taskbar check (assetsPath.ts loadTrayIcon)
//! - screenping:// registration and Electron leftovers (protocol.ts)

use base64::Engine;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use windows::Win32::Foundation::{HLOCAL, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::System::Registry::{
    RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, IsWindowVisible, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_BOTTOM,
    HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_SHOWNOACTIVATE,
    WINDOWPOS, WM_WINDOWPOSCHANGING, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
};

const GUARD_ID: usize = 0x5350; // "SP"

/// Never take focus, never appear in the taskbar or Alt+Tab.
pub fn make_tool_window(hwnd: HWND) {
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let ex = (ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0) as isize)
            & !(WS_EX_APPWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
    }
}

/// Show without focus and raise to the top of the top-most band
/// (Electron 1.0.72: showInactive + setAlwaysOnTop toggle + moveTop).
pub fn show_topmost_no_activate(hwnd: HWND) {
    let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            // A freshly shown window can land behind fullscreen apps despite
            // its old top-most flag: drop and re-apply it.
            let _ = SetWindowPos(hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, flags);
        }
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, flags);
    }
}

unsafe extern "system" fn guard_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_WINDOWPOSCHANGING && lparam.0 != 0 {
        let pos = &mut *(lparam.0 as *mut WINDOWPOS);
        if (pos.flags & SWP_NOZORDER).0 == 0
            && (pos.hwndInsertAfter == HWND_NOTOPMOST || pos.hwndInsertAfter == HWND_BOTTOM)
        {
            pos.hwndInsertAfter = HWND_TOPMOST;
        }
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

static KEEPER_RUNNING: AtomicBool = AtomicBool::new(false);
static KEEPER_GEN: AtomicU64 = AtomicU64::new(0);

/// Z-order guard plus a top-most re-assert every 800 ms.
/// Subclassing must happen on the window's thread, so `on_ui` runs it there.
pub fn set_keeper(hwnd: HWND, on: bool, on_ui: impl FnOnce(Box<dyn FnOnce() + Send>)) {
    let raw = hwnd.0 as isize;
    if on {
        if KEEPER_RUNNING.swap(true, Ordering::SeqCst) {
            return;
        }
        on_ui(Box::new(move || unsafe {
            let _ = SetWindowSubclass(HWND(raw as *mut _), Some(guard_proc), GUARD_ID, 0);
        }));
        let gen = KEEPER_GEN.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(800));
            if !KEEPER_RUNNING.load(Ordering::SeqCst) || KEEPER_GEN.load(Ordering::SeqCst) != gen {
                break;
            }
            show_topmost_no_activate(HWND(raw as *mut _));
        });
    } else if KEEPER_RUNNING.swap(false, Ordering::SeqCst) {
        on_ui(Box::new(move || unsafe {
            let _ = RemoveWindowSubclass(HWND(raw as *mut _), Some(guard_proc), GUARD_ID);
        }));
    }
}

pub fn idle_seconds() -> u64 {
    unsafe {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        if !GetLastInputInfo(&mut info).as_bool() {
            return 0;
        }
        (GetTickCount().wrapping_sub(info.dwTime) / 1000) as u64
    }
}

pub fn light_taskbar() -> bool {
    unsafe {
        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let key = windows::core::w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
        let name = windows::core::w!("SystemUsesLightTheme");
        let r = RegGetValueW(
            HKEY_CURRENT_USER,
            key,
            name,
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        );
        r.is_ok() && value == 1
    }
}

/// DPAPI, current user scope.
pub struct DpapiSecretBox;

const PREFIX: &str = "dpapi:v1:";

impl screenping_core::SecretBox for DpapiSecretBox {
    fn seal(&self, plain: &str) -> Result<String, String> {
        unsafe {
            let bytes = plain.as_bytes();
            let input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB::default();
            CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
                .map_err(|e| format!("Windows secure storage is unavailable: {e}"))?;
            let sealed = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            let _ = windows::Win32::Foundation::LocalFree(Some(HLOCAL(out.pbData as *mut _)));
            Ok(format!("{PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(sealed)))
        }
    }

    fn open(&self, sealed: &str) -> Result<String, String> {
        let b64 = sealed.strip_prefix(PREFIX).ok_or("not sealed")?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
        String::from_utf8(dpapi_unprotect(&bytes)?).map_err(|e| e.to_string())
    }
}

/// CryptUnprotectData, current user (also opens Chromium's `Local State` key).
pub fn dpapi_unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            .map_err(|e| e.to_string())?;
        let plain = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = windows::Win32::Foundation::LocalFree(Some(HLOCAL(out.pbData as *mut _)));
        Ok(plain)
    }
}

fn set_hkcu_string(key: &str, name: Option<&str>, value: &str) {
    let key = HSTRING::from(key);
    let name = name.map(HSTRING::from);
    let data: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = RegSetKeyValueW(
            HKEY_CURRENT_USER,
            &key,
            name.as_ref().map_or(PCWSTR::null(), |n| PCWSTR(n.as_ptr())),
            REG_SZ.0,
            Some(data.as_ptr() as *const _),
            (data.len() * 2) as u32,
        );
    }
}

fn get_hkcu_string(key: &str, name: &str) -> Option<String> {
    let key = HSTRING::from(key);
    let name = HSTRING::from(name);
    let mut buf = vec![0u16; 2048];
    let mut size = (buf.len() * 2) as u32;
    unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            &key,
            &name,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut size),
        )
        .ok()
        .ok()?;
    }
    let len = (size as usize / 2).saturating_sub(1).min(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
}

/// `app.setAsDefaultProtocolClient("screenping")`, per user.
pub fn register_protocol(exe: &str) {
    let root = r"Software\Classes\screenping";
    set_hkcu_string(root, None, "URL:Screen Ping");
    set_hkcu_string(root, Some("URL Protocol"), "");
    set_hkcu_string(&format!(r"{root}\DefaultIcon"), None, &format!("\"{exe}\",0"));
    set_hkcu_string(&format!(r"{root}\shell\open\command"), None, &format!("\"{exe}\" \"%1\""));
}

/// Drop the Electron app's start-at-login entry (its installer hook does this
/// too; this covers a manual install of this app next to Electron).
pub fn remove_electron_autostart() {
    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    const NAME: &str = "com.screenping.app";
    let Some(cmd) = get_hkcu_string(RUN, NAME) else { return };
    if !cmd.to_ascii_lowercase().contains("screen-ping-desktop") {
        return;
    }
    for key in [RUN, APPROVED] {
        unsafe {
            let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(key), &HSTRING::from(NAME));
        }
    }
}
