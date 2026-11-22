//! Win32 pieces Tauri does not expose.
//! - no-activate tool window + z-order guard (desktop/main/win32Overlay.ts)
//! - top-most keeper (overlayQueue.ts keepOverlayOnTop)
//! - idle time (Electron powerMonitor.getSystemIdleTime)
//! - DPAPI secret box (Electron safeStorage)
//! - light taskbar check (assetsPath.ts loadTrayIcon)

use base64::Engine;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use windows::Win32::Foundation::{HLOCAL, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
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
        unsafe {
            let input = CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB::default();
            CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
                .map_err(|e| e.to_string())?;
            let plain = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            let _ = windows::Win32::Foundation::LocalFree(Some(HLOCAL(out.pbData as *mut _)));
            String::from_utf8(plain).map_err(|e| e.to_string())
        }
    }
}
