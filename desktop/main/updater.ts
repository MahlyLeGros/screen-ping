import { spawn } from "child_process";

import { app, Notification, shell } from "electron";
import { autoUpdater, CancellationToken } from "electron-updater";

import { persistLoginForUpdate } from "./auth";
import { shutdownForUpdate } from "./shutdown";
import { applySteppedUpdateFeed } from "./updateFeed";
import { checkLatestVersion, getVersionCheckStatus } from "./versionCheck";

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { state: "ready"; version: string }
  | { state: "installing"; version: string }
  | { state: "up-to-date" }
  | { state: "error"; message: string };

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * An update that finishes downloading while the app is still fresh is applied
 * right away — restarting costs the user nothing that early. Anything later
 * waits for quit so we never yank the app away mid-session.
 */
const LAUNCH_INSTALL_WINDOW_MS = 2 * 60 * 1000;

let status: UpdateStatus = { state: "idle" };
let onStatusChange: ((s: UpdateStatus) => void) | null = null;
let periodicCheckTimer: ReturnType<typeof setInterval> | null = null;
let installInProgress = false;
let cancellation: CancellationToken | null = null;
let manualFlow = false;
let launchedAt = Date.now();
let openManualUpdateUi: (() => void) | null = null;
let checkInFlight = false;

function setStatus(next: UpdateStatus) {
  status = next;
  onStatusChange?.(next);
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function setUpdateStatusListener(cb: (s: UpdateStatus) => void) {
  onStatusChange = cb;
  cb(status);
}

/** Lets the deep-link / notification entry points raise the progress window. */
export function setManualUpdateUiOpener(open: () => void) {
  openManualUpdateUi = open;
}

async function openInstallerFallback() {
  const versionStatus = getVersionCheckStatus();
  if (versionStatus.state === "outdated") {
    await shell.openExternal(versionStatus.downloadUrl);
    return;
  }
  const latest = await checkLatestVersion();
  if (latest.state === "outdated") {
    await shell.openExternal(latest.downloadUrl);
    return;
  }
  const serverUrl = (await import("./store")).default.get("serverUrl");
  await shell.openExternal(`${serverUrl}/api/desktop/download?from=${encodeURIComponent(app.getVersion())}`);
}

function getDownloadedInstallerPath(): string | null {
  const helper = (
    autoUpdater as unknown as {
      downloadedUpdateHelper?: { packageFile?: string | null; file?: string | null } | null;
    }
  ).downloadedUpdateHelper;
  return helper?.packageFile ?? helper?.file ?? null;
}

/**
 * Always silent. `/S` suppresses the NSIS banner — it is a native SpiderBanner
 * dialog that cannot be themed, so we show our own window instead — and
 * `--force-run` brings the app back up once the files are swapped.
 */
function launchInstallerAt(installerPath: string) {
  persistLoginForUpdate();
  shutdownForUpdate();

  const child = spawn(installerPath, ["--updated", "/S", "--force-run"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  setTimeout(() => {
    app.exit(0);
  }, 1500);
}

function runInstall() {
  if (status.state !== "ready" || installInProgress) return;
  installInProgress = true;
  setStatus({ state: "installing", version: status.version });

  const installerPath = getDownloadedInstallerPath();
  if (installerPath) {
    launchInstallerAt(installerPath);
    return;
  }
  void openInstallerFallback();
}

function startDownload() {
  const token = new CancellationToken();
  cancellation = token;
  autoUpdater.downloadUpdate(token).catch((err: unknown) => {
    if (token.cancelled) return;
    setStatus({ state: "error", message: err instanceof Error ? err.message : String(err) });
  });
}

function notifyInstallDeferred(version: string) {
  if (!Notification.isSupported()) return;
  new Notification({
    title: "Screen Ping",
    body: `Mise à jour v${version} prête — elle s'installera à la fermeture.`,
  }).show();
}

async function runSteppedCheck() {
  if (!app.isPackaged || checkInFlight) return;
  checkInFlight = true;
  setStatus({ state: "checking" });
  try {
    const step = await applySteppedUpdateFeed();
    if (step.upToDate) {
      setStatus({ state: "up-to-date" });
      return;
    }
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setStatus({ state: "error", message: err instanceof Error ? err.message : String(err) });
    void checkLatestVersion();
  } finally {
    checkInFlight = false;
  }
}

export function initUpdater() {
  if (!app.isPackaged) return;

  launchedAt = Date.now();

  // We drive the download ourselves so it can be cancelled from the update window.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => setStatus({ state: "checking" }));
  autoUpdater.on("update-available", (info) => {
    setStatus({ state: "available", version: info.version });
    startDownload();
  });
  autoUpdater.on("update-not-available", () => setStatus({ state: "up-to-date" }));
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.floor(progress.percent);
    if (status.state === "downloading" && Math.floor(status.percent) === percent) return;
    setStatus({
      state: "downloading",
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    cancellation = null;
    setStatus({ state: "ready", version: info.version });

    // The user is watching the progress window — let them press the button.
    if (manualFlow) return;

    if (Date.now() - launchedAt < LAUNCH_INSTALL_WINDOW_MS) {
      runInstall();
      return;
    }
    notifyInstallDeferred(info.version);
  });
  autoUpdater.on("error", (err) => {
    cancellation = null;
    setStatus({ state: "error", message: err.message });
    void checkLatestVersion();
  });

  void runSteppedCheck();

  if (periodicCheckTimer) clearInterval(periodicCheckTimer);
  periodicCheckTimer = setInterval(() => {
    void runSteppedCheck();
  }, UPDATE_CHECK_INTERVAL_MS);
}

/** Background check — no window, install happens silently. */
export function checkForUpdates() {
  if (!app.isPackaged) return;
  void runSteppedCheck();
}

export function hasReadyUpdate(): boolean {
  return status.state === "ready";
}

export function isManualUpdate(): boolean {
  return manualFlow;
}

/** User asked for the update: the progress window owns the flow from here. */
export function beginManualUpdate() {
  manualFlow = true;
  if (!app.isPackaged) return;
  if (status.state === "downloading" || status.state === "ready" || status.state === "installing") return;

  void runSteppedCheck();
  void checkLatestVersion();
}

export function endManualUpdate() {
  manualFlow = false;
}

export function cancelUpdate() {
  cancellation?.cancel();
  cancellation = null;
  manualFlow = false;
  if (status.state === "checking" || status.state === "available" || status.state === "downloading") {
    setStatus({ state: "idle" });
  }
}

/** Deep link `screenping://update` — same as clicking Update in the app. */
export function beginWebUpdate() {
  openManualUpdateUi?.();
  beginManualUpdate();
}

/** No installer UI on any path — the app closes and relaunches itself. */
export function installUpdate() {
  runInstall();
}
