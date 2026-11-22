//! Win32 pieces Tauri does not expose: no-activate tool window and the
//! z-order guard ported from desktop/main/win32Overlay.ts.

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_BOTTOM,
    HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SW_SHOWNOACTIVATE, WINDOWPOS, WM_WINDOWPOSCHANGING, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
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

pub fn show_topmost_no_activate(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
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

/// Block Windows from demoting the overlay below a fullscreen app.
pub fn enable_zorder_guard(hwnd: HWND) {
    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(guard_proc), GUARD_ID, 0);
    }
}

pub fn disable_zorder_guard(hwnd: HWND) {
    unsafe {
        let _ = RemoveWindowSubclass(hwnd, Some(guard_proc), GUARD_ID);
    }
}
