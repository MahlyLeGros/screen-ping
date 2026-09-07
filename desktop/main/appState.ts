import { app, screen } from "electron";

import { labelDisplays } from "./displayLayout";
import store from "./store";
import { getUpdateStatus } from "./updater";
import { getVersionCheckStatus } from "./versionCheck";

export interface DisplayInfo {
  id: number;
  label: string;
  shortLabel: string;
  primary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface DesktopState {
  version: string;
  packaged: boolean;
  username: string | null;
  userId: string | null;
  serverUrl: string;
  connected: boolean;
  online: boolean;
  paused: boolean;
  launchAtLogin: boolean;
  alwaysOnTop: boolean;
  compact: boolean;
  overlayDisplayId: number | null;
  displays: DisplayInfo[];
  update: {
    state: string;
    version?: string;
    percent?: number;
    transferred?: number;
    total?: number;
    bytesPerSecond?: number;
    message?: string;
  };
  latestVersion: string | null;
  outdated: boolean;
}

export type SettingKey =
  | "online"
  | "paused"
  | "launchAtLogin"
  | "alwaysOnTop"
  | "compact"
  | "overlayDisplayId";

export type AppTab = "receive" | "friends" | "send";

export type ActionName =
  | "open-window"
  | "reconnect"
  | "logout"
  | "quit"
  | "check-updates"
  | "install-update"
  | "cancel-update"
  | "open-dashboard"
  | "open-kofi"
  | "open-friends"
  | "open-send";

let cachedUserId: string | null = null;

export function setCachedUserId(userId: string | null) {
  cachedUserId = userId;
}

export function getCachedUserId(): string | null {
  return cachedUserId;
}

function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return labelDisplays(screen.getAllDisplays(), primaryId);
}

export function buildDesktopState(connected: boolean): DesktopState {
  const versionStatus = getVersionCheckStatus();
  const updateStatus = getUpdateStatus() as DesktopState["update"];

  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    username: store.get("savedUsername"),
    userId: cachedUserId,
    serverUrl: store.get("serverUrl"),
    connected,
    online: store.get("online"),
    paused: store.get("paused"),
    launchAtLogin: store.get("launchAtLogin"),
    alwaysOnTop: store.get("alwaysOnTop"),
    compact: store.get("compact"),
    overlayDisplayId: store.get("overlayDisplayId"),
    displays: listDisplays(),
    update: updateStatus,
    // When outdated, expose the next stepwise target so UI offers N→N+1 not a jump to tip.
    latestVersion:
      versionStatus.state === "outdated"
        ? versionStatus.nextVersion
        : versionStatus.state === "current"
          ? versionStatus.latestVersion
          : null,
    outdated: versionStatus.state === "outdated",
  };
}
