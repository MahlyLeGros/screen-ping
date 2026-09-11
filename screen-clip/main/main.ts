import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Notification,
  shell,
} from "electron";
import fs from "fs";
import path from "path";
import { buildAppState } from "./appState";
import { bufferRecorder } from "./bufferRecorder";
import { normalizeEncoding } from "./ffmpegArgs";
import { probeEncoders } from "./ffmpegPath";
import type { VideoEncoderId } from "./store";
import store, {
  applyLaunchAtLoginDefault,
  getAllSettings,
  setStoredValue,
  type ClipSettings,
} from "./store";
import { createTray, destroyTray, updateTrayTooltip } from "./tray";
import {
  createSettingsWindow,
  ensureMenuWindow,
  getMenuWindow,
  getSettingsWindow,
  hideMenuWindow,
  revealMenuWindow,
  resizeMenuWindow,
} from "./windows";

if (process.platform === "win32") {
  app.setAppUserModelId("com.screenclip.app");
}

let availableEncoders: VideoEncoderId[] = ["libx264"];
let encodingWarning: string | null = null;

function startedHidden(): boolean {
  return process.argv.includes("--hidden");
}

function setupAutoLaunch() {
  if (!app.isPackaged || process.platform !== "win32") return;
  app.setLoginItemSettings({
    openAtLogin: store.get("launchAtLogin"),
    path: process.execPath,
    args: ["--hidden"],
  });
}

function pushState() {
  const state = buildAppState(bufferRecorder.getState(), availableEncoders, encodingWarning);
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const menu = getMenuWindow();
    if (menu && win === menu && !menu.isVisible()) continue;
    win.webContents.send("app:state", state);
  }
  const status = state.buffer.status;
  updateTrayTooltip(
    status === "running"
      ? "Screen Clip — buffer ON"
      : status === "paused"
        ? "Screen Clip — paused"
        : status === "error"
          ? "Screen Clip — error"
          : "Screen Clip",
  );
}

function refreshEncodingWarning(settings: ClipSettings = getAllSettings()) {
  encodingWarning = normalizeEncoding(settings).warning ?? null;
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const hotkey = store.get("hotkey");
  const ok = globalShortcut.register(hotkey, () => {
    void saveClip();
  });
  if (!ok) console.warn("Failed to register hotkey", hotkey);
}

async function saveClip() {
  const settings = getAllSettings();
  const clipPath = await bufferRecorder.flushClip(settings);
  pushState();
  if (!clipPath) {
    if (Notification.isSupported()) {
      new Notification({
        title: "Screen Clip",
        body: bufferRecorder.getState().lastError || "Could not save clip",
      }).show();
    }
    return;
  }
  if (Notification.isSupported()) {
    const n = new Notification({ title: "Clip saved", body: path.basename(clipPath) });
    n.on("click", () => {
      shell.showItemInFolder(clipPath);
    });
    n.show();
  }
}

const RESTART_KEYS = new Set<keyof ClipSettings>([
  "bufferSeconds",
  "displayId",
  "includeMic",
  "includeSystemAudio",
  "resolutionMode",
  "customWidth",
  "customHeight",
  "fps",
  "scaleFilter",
  "videoEncoder",
  "rateControl",
  "videoBitrateKbps",
  "encoderPreset",
  "keyframeIntervalSec",
  "audioCodec",
  "audioBitrateKbps",
  "sampleRate",
  "containerFormat",
]);

async function applySetting(key: keyof ClipSettings, value: ClipSettings[keyof ClipSettings]) {
  setStoredValue(key, value as never);
  refreshEncodingWarning();

  if (key === "launchAtLogin") setupAutoLaunch();
  if (key === "hotkey") registerHotkey();

  if (key === "bufferEnabled") {
    if (value) await bufferRecorder.resume();
    else await bufferRecorder.pause();
  } else if (RESTART_KEYS.has(key) && store.get("bufferEnabled")) {
    await bufferRecorder.restart();
  }

  pushState();
}

function wireIpc() {
  ipcMain.handle("app:get-state", () =>
    buildAppState(bufferRecorder.getState(), availableEncoders, encodingWarning),
  );

  ipcMain.on("app:set", (_event, payload: { key: string; value: unknown }) => {
    void applySetting(payload.key as keyof ClipSettings, payload.value as never);
  });

  ipcMain.on("app:action", (_event, name: string) => {
    void (async () => {
      switch (name) {
        case "save-clip":
          await saveClip();
          break;
        case "pause-buffer":
          await bufferRecorder.pause();
          break;
        case "resume-buffer":
          await bufferRecorder.resume();
          break;
        case "open-settings":
          hideMenuWindow();
          createSettingsWindow();
          break;
        case "open-output-dir": {
          const dir = store.get("outputDir");
          fs.mkdirSync(dir, { recursive: true });
          await shell.openPath(dir);
          break;
        }
        case "toggle-launch-at-login":
          await applySetting("launchAtLogin", !store.get("launchAtLogin"));
          break;
        case "quit":
          app.quit();
          break;
        default:
          break;
      }
      pushState();
    })();
  });

  ipcMain.on("win:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on("win:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.on("menu:hide", () => hideMenuWindow());
  ipcMain.on("menu:resize", (_event, payload: { width: number; height: number }) => {
    resizeMenuWindow(payload.width, payload.height);
  });

  ipcMain.handle("dialog:pick-output-dir", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      defaultPath: store.get("outputDir"),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await applySetting("outputDir", result.filePaths[0]);
    return result.filePaths[0];
  });
}

async function startApp() {
  applyLaunchAtLoginDefault();
  setupAutoLaunch();
  refreshEncodingWarning();

  availableEncoders = await probeEncoders();
  if (!availableEncoders.includes(store.get("videoEncoder"))) {
    setStoredValue("videoEncoder", "libx264");
  }

  wireIpc();
  ensureMenuWindow();

  createTray(
    {
      onOpenMenu: (bounds) => {
        const anchor = bounds
          ? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y) }
          : undefined;
        revealMenuWindow(anchor);
        pushState();
      },
    },
    "Screen Clip",
  );

  registerHotkey();
  bufferRecorder.onChange(() => pushState());
  await bufferRecorder.start(getAllSettings());
  pushState();

  if (!startedHidden()) {
    createSettingsWindow();
  }
}

app.whenReady().then(() => {
  void startApp();
});

app.on("window-all-closed", () => {
  // Keep running in the tray on Windows/Linux.
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  void bufferRecorder.stop();
  destroyTray();
});

app.on("activate", () => {
  if (!getSettingsWindow()) createSettingsWindow();
});
