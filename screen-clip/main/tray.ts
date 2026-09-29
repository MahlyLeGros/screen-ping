import { Tray } from "electron";
import { loadTrayIcon } from "./assetsPath";

let tray: Tray | null = null;
let trayReadyAt = 0;
const TRAY_CLICK_GRACE_MS = 600;

export type TrayCallbacks = {
  onOpenMenu: (bounds?: Electron.Rectangle) => void;
};

function onUserTrayClick(callbacks: TrayCallbacks, bounds?: Electron.Rectangle) {
  if (Date.now() - trayReadyAt < TRAY_CLICK_GRACE_MS) return;
  callbacks.onOpenMenu(bounds);
}

export function createTray(callbacks: TrayCallbacks, tooltip: string): Tray {
  if (tray) {
    tray.setToolTip(tooltip);
    return tray;
  }
  tray = new Tray(loadTrayIcon());
  trayReadyAt = Date.now();
  tray.setToolTip(tooltip);
  tray.on("click", (_e, bounds) => onUserTrayClick(callbacks, bounds));
  tray.on("right-click", (_e, bounds) => onUserTrayClick(callbacks, bounds));
  return tray;
}

export function updateTrayTooltip(tooltip: string) {
  tray?.setToolTip(tooltip);
}

export function destroyTray() {
  tray?.destroy();
  tray = null;
}
