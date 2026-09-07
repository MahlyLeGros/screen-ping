import { app } from "electron";

import { beginWebUpdate } from "./updater";

export const DESKTOP_UPDATE_PROTOCOL = "screenping://update";

export function getProtocolUrlFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.toLowerCase().startsWith("screenping://")) ?? null;
}

export function registerProtocolClient() {
  if (!app.isPackaged) return;

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("screenping", process.execPath, [process.argv[1]]);
    }
  } else {
    app.setAsDefaultProtocolClient("screenping");
  }
}

export function handleProtocolUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  if (url.protocol !== "screenping:") return;

  const action = (url.hostname || url.pathname.replace(/^\//, "") || "update").toLowerCase();
  if (action === "linked" || action === "auth") {
    return;
  }
  if (action === "update" || action === "" || action === "install") {
    beginWebUpdate();
  }
}
