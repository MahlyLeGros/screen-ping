import { Tray } from "electron";
import store from "./store";
import { loadTrayIcon } from "./assetsPath";

let tray: Tray | null = null;
let trayReadyAt = 0;
const TRAY_CLICK_GRACE_MS = 600;

export type TrayCallbacks = {
  onOpenWindow: () => void;
  onOpenMenu: (trayBounds?: Electron.Rectangle) => void;
  onToggleOnline: () => void;
  onTogglePause: () => void;
  onQuit: () => void;
  onReconnect: () => void;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onDownloadUpdate: () => void;
  onLogout: () => void;
  onSelectOverlayDisplay: (displayId: number) => void;
};

function onUserTrayClick(callbacks: TrayCallbacks, bounds?: Electron.Rectangle) {
  // Windows often fires a fake click when the tray icon is created.
  if (Date.now() - trayReadyAt < TRAY_CLICK_GRACE_MS) return;
  callbacks.onOpenMenu(bounds);
}

/**
 * No native context menu: right-click opens the custom popup window so the
 * menu matches the rest of the app instead of the Windows shell styling.
 */
export function createTray(callbacks: TrayCallbacks, connected: boolean): Tray {
  if (tray) {
    updateTrayMenu(callbacks, connected);
    return tray;
  }

  tray = new Tray(loadTrayIcon());
  trayReadyAt = Date.now();
  tray.on("click", (_event, bounds) => onUserTrayClick(callbacks, bounds));
  tray.on("right-click", (_event, bounds) => onUserTrayClick(callbacks, bounds));
  updateTrayMenu(callbacks, connected);
  return tray;
}

export function updateTrayMenu(_callbacks: TrayCallbacks, connected: boolean) {
  if (!tray) return;

  const paused = store.get("paused");
  const online = store.get("online");

  if (!online) {
    tray.setToolTip("Screen Ping — offline");
    return;
  }
  tray.setToolTip(
    connected ? `Screen Ping — connected${paused ? " (paused)" : ""}` : "Screen Ping — connecting…",
  );
}

export function destroyTray() {
  tray?.destroy();
  tray = null;
}
