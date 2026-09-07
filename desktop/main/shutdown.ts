import { BrowserWindow, app } from "electron";

import { destroyTray } from "./tray";

let quittingForUpdate = false;

export function isQuittingForUpdate(): boolean {
  return quittingForUpdate;
}

export function shutdownForUpdate() {
  quittingForUpdate = true;

  try {
    app.releaseSingleInstanceLock();
  } catch {
    // ignore
  }

  destroyTray();

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.removeAllListeners("close");
      win.destroy();
    }
  }
}
