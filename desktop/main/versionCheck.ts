import { app, Notification, shell } from "electron";

import { normalizeServerUrl } from "./serverUrl";
import store from "./store";
import { fetchNextUpdate } from "./updateFeed";
import { checkForUpdates } from "./updater";

export type VersionCheckStatus =
  | { state: "unknown" }
  | { state: "current"; latestVersion: string }
  | {
      state: "outdated";
      currentVersion: string;
      /** Next stepwise target (install this first). */
      nextVersion: string;
      /** Absolute newest published build. */
      latestVersion: string;
      downloadUrl: string;
    };

let status: VersionCheckStatus = { state: "unknown" };
let onStatusChange: ((s: VersionCheckStatus) => void) | null = null;
let notifiedThisSession = false;

function parseVersion(version: string): [number, number, number] {
  const parts = version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isVersionOlder(current: string, latest: string): boolean {
  const [currentMajor, currentMinor, currentPatch] = parseVersion(current);
  const [latestMajor, latestMinor, latestPatch] = parseVersion(latest);
  if (currentMajor !== latestMajor) return currentMajor < latestMajor;
  if (currentMinor !== latestMinor) return currentMinor < latestMinor;
  return currentPatch < latestPatch;
}

function setStatus(next: VersionCheckStatus) {
  status = next;
  onStatusChange?.(next);
}

export function getVersionCheckStatus(): VersionCheckStatus {
  return status;
}

export function setVersionCheckStatusListener(cb: (s: VersionCheckStatus) => void) {
  onStatusChange = cb;
  cb(status);
}

function maybeNotifyOutdated(info: Extract<VersionCheckStatus, { state: "outdated" }>) {
  if (notifiedThisSession || !Notification.isSupported()) return;
  notifiedThisSession = true;

  const multiStep = isVersionOlder(info.nextVersion, info.latestVersion);
  const body = multiStep
    ? `Tu as la v${info.currentVersion}. Prochaine étape : v${info.nextVersion} (dernière : v${info.latestVersion}).`
    : `Tu as la v${info.currentVersion}. Clique pour lancer la mise à jour vers la v${info.nextVersion}.`;

  const notification = new Notification({
    title: "Screen Ping — mise à jour disponible",
    body,
  });
  notification.on("click", () => {
    checkForUpdates();
  });
  notification.show();
}

export async function checkLatestVersion(): Promise<VersionCheckStatus> {
  if (!app.isPackaged) {
    const latestVersion = app.getVersion();
    setStatus({ state: "current", latestVersion });
    return status;
  }

  const currentVersion = app.getVersion();

  try {
    const nextInfo = await fetchNextUpdate(currentVersion);
    if (!nextInfo) {
      setStatus({ state: "unknown" });
      return status;
    }

    const latestVersion = nextInfo.latest || nextInfo.version || currentVersion;
    if (nextInfo.next && isVersionOlder(currentVersion, nextInfo.next)) {
      const downloadUrl =
        nextInfo.download_url ||
        `${normalizeServerUrl(store.get("serverUrl"))}/api/desktop/download?from=${encodeURIComponent(currentVersion)}`;
      const next: VersionCheckStatus = {
        state: "outdated",
        currentVersion,
        nextVersion: nextInfo.next,
        latestVersion,
        downloadUrl,
      };
      setStatus(next);
      maybeNotifyOutdated(next);
      return next;
    }

    setStatus({ state: "current", latestVersion });
    return status;
  } catch {
    setStatus({ state: "unknown" });
    return status;
  }
}

export function openLatestDownload() {
  if (status.state === "outdated") {
    void shell.openExternal(status.downloadUrl);
    return;
  }

  void checkLatestVersion().then((latest) => {
    if (latest.state === "outdated") {
      void shell.openExternal(latest.downloadUrl);
      return;
    }
    checkForUpdates();
  });
}

export function initVersionCheck() {
  if (!app.isPackaged) return;

  const run = () => void checkLatestVersion();
  run();
  setTimeout(run, 5_000);
  setTimeout(run, 30_000);
  setInterval(run, 4 * 60 * 60 * 1000);
}
