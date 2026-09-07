import { BrowserWindow } from "electron";

const WM_WINDOWPOSCHANGING = 0x0046;
const SWP_NOZORDER = 0x0004;
const HWND_TOPMOST = -1n;
const HWND_NOTOPMOST = -2n;
const HWND_BOTTOM = 1n;

let guardedWindow: BrowserWindow | null = null;

/**
 * Block Windows from demoting the overlay below a fullscreen app.
 * Only hooks during an active ping (after fade-in) so initial show is unaffected.
 */
export function enableOverlayZOrderGuard(win: BrowserWindow) {
  if (process.platform !== "win32" || guardedWindow === win) return;
  disableOverlayZOrderGuard();

  guardedWindow = win;
  win.hookWindowMessage(WM_WINDOWPOSCHANGING, (_wParam, lParam) => {
    if (lParam.length < 36) return;

    const flags = lParam.readUInt32LE(32);
    if (flags & SWP_NOZORDER) return;

    const insertAfter = lParam.readBigInt64LE(8);
    if (insertAfter === HWND_NOTOPMOST || insertAfter === HWND_BOTTOM) {
      lParam.writeBigInt64LE(HWND_TOPMOST, 8);
    }
  });
}

export function disableOverlayZOrderGuard() {
  if (!guardedWindow || guardedWindow.isDestroyed()) {
    guardedWindow = null;
    return;
  }

  try {
    guardedWindow.unhookWindowMessage(WM_WINDOWPOSCHANGING);
  } catch {
    // Window may already be tearing down.
  }
  guardedWindow = null;
}

/** Minimal fix-up — only act when something actually changed. */
export function ensureOverlayShown(win: BrowserWindow) {
  if (!win.isVisible()) {
    win.showInactive();
  }

  if (process.platform === "win32") {
    if (!win.isAlwaysOnTop()) {
      win.setAlwaysOnTop(true, "screen-saver", 2);
    }
  } else if (process.platform === "darwin") {
    if (!win.isAlwaysOnTop()) {
      win.setAlwaysOnTop(true, "screen-saver");
    }
  } else if (!win.isAlwaysOnTop()) {
    win.setAlwaysOnTop(true);
  }
}
