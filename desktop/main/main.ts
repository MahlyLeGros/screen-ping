import { app, BrowserWindow, dialog, ipcMain, Notification, screen, shell } from "electron";
import { pinStableUserData } from "./userData";

pinStableUserData();

if (process.platform === "win32") {
  // Stop Windows/Chromium from hiding or throttling the overlay behind fullscreen apps.
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.setAppUserModelId("com.screenping.app");
}

import store, { applyLaunchAtLoginDefault, clearSessionTokens } from "./store";
import { OverlayQueue } from "./overlayQueue";
import { drawOverlay } from "./drawOverlay";
import { clearLoginCredentials, cancelBrowserLogin, getSavedLoginForm, loginAndRemember, loginViaBrowser, tryRestoreSession } from "./auth";
import { ackMessage, connectSocket, disconnectSocket, isConnected, sendMessage, setFriendsUpdateHandler, setPresenceHandler, setSessionExpiredHandler } from "./socketClient";
import {
  acceptFriend,
  blockFriend,
  declineFriend,
  fetchMe,
  listFriends,
  removeFriend,
  requestFriend,
  setApiSessionExpiredHandler,
  unblockFriend,
  uploadMedia,
} from "./apiClient";
import {
  applyWindowMode,
  createLoginWindow,
  createMainWindow,
  createMenuWindow,
  createOverlayWindow,
  createUpdateWindow,
  FULL_MIN_HEIGHT,
  getAccessToken,
  parkOverlayWindow,
  positionMenuWindow,
  positionOverlayWindow,
  setOverlayDisplayId,
} from "./windows";
import { ActionName, AppTab, buildDesktopState, setCachedUserId, SettingKey } from "./appState";
import { createTray, destroyTray, TrayCallbacks, updateTrayMenu } from "./tray";
import {
  beginManualUpdate,
  cancelUpdate,
  endManualUpdate,
  hasReadyUpdate,
  initUpdater,
  installUpdate,
  setManualUpdateUiOpener,
  setUpdateStatusListener,
} from "./updater";
import { initVersionCheck, openLatestDownload, setVersionCheckStatusListener } from "./versionCheck";
import {
  getProtocolUrlFromArgv,
  handleProtocolUrl,
  registerProtocolClient,
} from "./protocol";
import { applyServerUrlPreference } from "./serverUrl";

applyServerUrlPreference(store);
applyLaunchAtLoginDefault();

let loginWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let menuWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let updateWindow: BrowserWindow | null = null;
let lastMenuAnchor: Electron.Point | null = null;
let menuHiddenAt = 0;
let menuSized = false;
let menuPendingShow = false;
let connected = false;
let watchdogStarted = false;

const overlayQueue = new OverlayQueue((messageId, status) => {
  ackMessage(messageId, status);
});

function setupAutoLaunch() {
  if (!app.isPackaged || process.platform !== "win32") return;

  app.setLoginItemSettings({
    openAtLogin: store.get("launchAtLogin"),
    path: process.execPath,
    args: ["--hidden"],
  });
}

/** Auto-start puts the app straight in the tray; a manual launch opens the window. */
function startedHidden(): boolean {
  return process.argv.includes("--hidden");
}

function pushState() {
  const state = buildDesktopState(connected);
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    // Menu only needs live state while opening or visible — background pushes re-render
    // the hidden window and can flicker the cursor on the active window.
    if (menuWindow && win === menuWindow && !menuPendingShow && !menuWindow.isVisible()) continue;
    win.webContents.send("app:state", state);
  }
}

function hideMenuWindow() {
  if (menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible()) {
    menuWindow.hide();
    menuHiddenAt = Date.now();
  }
}

/** Created up front (hidden) so its measured size is known before the first open. */
function ensureMenuWindow(): BrowserWindow {
  if (menuWindow && !menuWindow.isDestroyed()) return menuWindow;

  menuSized = false;
  menuPendingShow = false;
  menuWindow = createMenuWindow();
  menuWindow.on("blur", hideMenuWindow);
  menuWindow.on("closed", () => {
    menuWindow = null;
    menuSized = false;
    menuPendingShow = false;
  });
  return menuWindow;
}

function showMenuWindow() {
  const win = ensureMenuWindow();

  menuSized = false;
  menuPendingShow = true;
  win.webContents.send("app:state", buildDesktopState(connected));

  // Fallback if the renderer measure IPC is delayed or missed.
  setTimeout(() => {
    if (!menuPendingShow || !menuWindow || menuWindow.isDestroyed()) return;
    menuPendingShow = false;
    menuSized = true;
    revealMenuWindow();
  }, 400);
}

function revealMenuWindow() {
  if (!menuWindow || menuWindow.isDestroyed()) return;
  positionMenuWindow(menuWindow, lastMenuAnchor);
  menuWindow.show();
  menuWindow.focus();
}

function toggleMenuWindow(_trayBounds?: Electron.Rectangle) {
  // Tray bounds point at the icon slot in the taskbar, not where the user
  // clicked when the icon lives in the overflow flyout — capture the cursor now.
  lastMenuAnchor = screen.getCursorScreenPoint();

  // Clicking the tray icon while the popup is open blurs it first, so without
  // this guard the same click would immediately reopen the menu.
  if (Date.now() - menuHiddenAt < 250) return;

  if (menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible()) {
    hideMenuWindow();
    return;
  }

  showMenuWindow();
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function openAppTab(tab: AppTab) {
  if (store.get("compact")) {
    store.set("compact", false);
    if (mainWindow && !mainWindow.isDestroyed()) {
      applyWindowMode(mainWindow, false);
    }
  }
  showMainWindow();
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:open-tab", tab);
    }
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", send);
    } else {
      send();
    }
  }
  pushState();
}

async function refreshMeProfile() {
  try {
    const me = await fetchMe();
    setCachedUserId(me.id);
    pushState();
  } catch {
    /* ignore — friends tab will surface errors */
  }
}

function showUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    if (updateWindow.isMinimized()) updateWindow.restore();
    updateWindow.show();
    updateWindow.focus();
    return;
  }
  updateWindow = createUpdateWindow();
  updateWindow.on("closed", () => {
    updateWindow = null;
    // Closing the window just stops us watching — a download in flight keeps
    // going and falls back to the silent install path.
    endManualUpdate();
  });
}

function closeUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
  updateWindow = null;
}

function startManualUpdate() {
  showUpdateWindow();
  beginManualUpdate();
}

function reconnectSocket() {
  if (!store.get("online") || !getAccessToken()) {
    disconnectSocket();
    connected = false;
    refreshTray();
    return;
  }
  connectSocket(
    (payload) => overlayQueue.enqueue(payload, store.get("paused")),
    (isConnected) => {
      connected = isConnected;
      refreshTray();
    },
    (messageId) => overlayQueue.revoke(messageId),
  );
}

function startConnectionWatchdog() {
  if (watchdogStarted) return;
  watchdogStarted = true;
  setInterval(() => {
    if (!store.get("online") || !getAccessToken()) return;
    if (isConnected()) return;
    reconnectSocket();
  }, 12_000);
}

function scheduleStartupReconnect() {
  if (!getAccessToken()) return;

  if (!store.get("online")) {
    store.set("online", true);
  }

  const delays = [0, 2000, 5000, 10000];
  for (const delayMs of delays) {
    setTimeout(() => {
      if (!getAccessToken() || !store.get("online")) return;
      if (connected || isConnected()) return;
      reconnectSocket();
    }, delayMs);
  }
}

function handleLogout() {
  disconnectSocket();
  clearSessionTokens();
  clearLoginCredentials();
  setCachedUserId(null);
  connected = false;
  mainWindow?.close();
  mainWindow = null;
  menuWindow?.close();
  menuWindow = null;
  overlayWindow?.close();
  overlayWindow = null;
  destroyTray();
  showLoginWindow();
}

function trayCallbacks(): TrayCallbacks {
  return {
    onOpenWindow: showMainWindow,
    onOpenMenu: toggleMenuWindow,
    onToggleOnline: () => {
      store.set("online", !store.get("online"));
      reconnectSocket();
    },
    onTogglePause: () => {
      store.set("paused", !store.get("paused"));
      refreshTray();
    },
    onQuit: () => app.quit(),
    onReconnect: reconnectSocket,
    onCheckUpdates: startManualUpdate,
    onInstallUpdate: () => installUpdate(),
    onDownloadUpdate: () => openLatestDownload(),
    onLogout: handleLogout,
    onSelectOverlayDisplay: (displayId) => {
      setOverlayDisplayId(displayId);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (overlayQueue.isShowing()) positionOverlayWindow(overlayWindow);
        else parkOverlayWindow(overlayWindow);
      }
      refreshTray();
    },
  };
}

function refreshTray() {
  updateTrayMenu(trayCallbacks(), connected);
  pushState();
}

function applySetting(key: SettingKey, value: boolean | number | null) {
  switch (key) {
    case "online":
      store.set("online", Boolean(value));
      reconnectSocket();
      break;
    case "paused":
      store.set("paused", Boolean(value));
      break;
    case "launchAtLogin":
      store.set("launchAtLogin", Boolean(value));
      setupAutoLaunch();
      break;
    case "alwaysOnTop":
      store.set("alwaysOnTop", Boolean(value));
      mainWindow?.setAlwaysOnTop(Boolean(value));
      break;
    case "compact":
      store.set("compact", Boolean(value));
      if (mainWindow && !mainWindow.isDestroyed()) {
        applyWindowMode(mainWindow, Boolean(value));
      }
      break;
    case "overlayDisplayId":
      setOverlayDisplayId(Number(value));
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (overlayQueue.isShowing()) positionOverlayWindow(overlayWindow);
        else parkOverlayWindow(overlayWindow);
      }
      break;
  }
  refreshTray();
}

function runAction(name: ActionName) {
  const callbacks = trayCallbacks();
  switch (name) {
    case "open-window":
      openAppTab("receive");
      break;
    case "reconnect":
      callbacks.onReconnect();
      break;
    case "logout":
      callbacks.onLogout();
      break;
    case "quit":
      callbacks.onQuit();
      break;
    case "check-updates":
      callbacks.onCheckUpdates();
      break;
    case "install-update":
      callbacks.onInstallUpdate();
      break;
    case "cancel-update":
      cancelUpdate();
      closeUpdateWindow();
      break;
    case "open-dashboard":
      void shell.openExternal(store.get("serverUrl"));
      break;
    case "open-kofi":
      void shell.openExternal("https://ko-fi.com/screenping");
      break;
    case "open-friends":
      openAppTab("friends");
      break;
    case "open-send":
      openAppTab("send");
      break;
  }
  refreshTray();
}

function showLoginWindow() {
  if (loginWindow) return;
  loginWindow = createLoginWindow();
  loginWindow.on("closed", () => {
    cancelBrowserLogin();
    loginWindow = null;
    if (!getAccessToken()) app.quit();
  });
}

async function handleSessionExpired() {
  disconnectSocket();
  clearSessionTokens();
  setCachedUserId(null);
  connected = false;
  overlayWindow?.close();
  overlayWindow = null;

  if (await tryRestoreSession()) {
    startApp();
    scheduleStartupReconnect();
    refreshTray();
    return;
  }

  mainWindow?.close();
  mainWindow = null;
  showLoginWindow();
  if (Notification.isSupported()) {
    new Notification({
      title: "Screen Ping",
      body: "Session expired — please log in again.",
    }).show();
  }
  refreshTray();
}

async function bootstrap() {
  registerProtocolClient();
  setupAutoLaunch();
  setSessionExpiredHandler(handleSessionExpired);
  setApiSessionExpiredHandler(() => {
    void handleSessionExpired();
  });
  setPresenceHandler((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:presence", payload);
    }
  });
  setFriendsUpdateHandler(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:friends");
    }
  });
  setUpdateStatusListener(() => refreshTray());
  setVersionCheckStatusListener(() => refreshTray());
  setManualUpdateUiOpener(showUpdateWindow);
  initUpdater();
  initVersionCheck();

  ipcMain.handle("auth:get-saved-login", () => getSavedLoginForm());

  ipcMain.handle("auth:login", async (_event, { username, password, remember = true }) => {
    await loginAndRemember(username, password, remember !== false);
    loginWindow?.close();
    startApp();
    scheduleStartupReconnect();
    return { ok: true };
  });

  ipcMain.handle("auth:browser-login", async (_event, { mode, remember = true }: { mode: "google" | "web"; remember?: boolean }) => {
    await loginViaBrowser(mode === "google" ? "google" : "web", remember !== false);
    loginWindow?.close();
    startApp();
    scheduleStartupReconnect();
    return { ok: true };
  });

  ipcMain.handle("auth:cancel-browser-login", () => {
    cancelBrowserLogin();
    return { ok: true };
  });

  ipcMain.handle("app:get-state", () => buildDesktopState(connected));

  ipcMain.on("app:set", (_event, { key, value }: { key: SettingKey; value: boolean | number | null }) => {
    applySetting(key, value);
  });

  ipcMain.on("app:action", (_event, name: ActionName) => {
    runAction(name);
  });

  ipcMain.on("win:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on("win:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on("menu:resize", (_event, { width, height }: { width: number; height: number }) => {
    if (!menuWindow || menuWindow.isDestroyed()) return;
    if (height < 48) return;

    const bounds = menuWindow.getBounds();
    const next = { width: Math.round(width), height: Math.round(height) };
    const sizeChanged = bounds.width !== next.width || bounds.height !== next.height;
    if (sizeChanged) {
      menuWindow.setBounds({ ...bounds, ...next });
    }
    menuSized = true;

    if (menuPendingShow) {
      menuPendingShow = false;
      revealMenuWindow();
      return;
    }
    if (sizeChanged && menuWindow.isVisible()) {
      positionMenuWindow(menuWindow, lastMenuAnchor);
    }
  });

  ipcMain.on("menu:hide", hideMenuWindow);

  ipcMain.on("win:resize-content", (event, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const compact = store.get("compact");
    const minH = compact ? 96 : FULL_MIN_HEIGHT;
    const maxH = compact ? 400 : 900;
    const target = Math.max(minH, Math.min(maxH, Math.round(height)));
    const bounds = win.getBounds();
    if (bounds.height !== target) {
      win.setBounds({ ...bounds, height: target }, false);
    }
  });

  ipcMain.on("overlay:dismiss", () => {
    overlayQueue.dismissCurrent();
  });

  ipcMain.on("draw:idle", () => {
    drawOverlay.onRendererIdle();
  });

  ipcMain.handle("friends:list", () => listFriends());
  ipcMain.handle("friends:request", (_e, username: string) => requestFriend(username));
  ipcMain.handle("friends:accept", (_e, id: string) => acceptFriend(id));
  ipcMain.handle("friends:decline", (_e, id: string) => declineFriend(id));
  ipcMain.handle("friends:remove", (_e, id: string) => removeFriend(id));
  ipcMain.handle("friends:block", (_e, id: string) => blockFriend(id));
  ipcMain.handle("friends:unblock", (_e, id: string) => unblockFriend(id));

  ipcMain.handle(
    "media:upload",
    (_e, payload: { receiverIds: string[]; filePath: string; caption?: string; soundPath?: string }) =>
      uploadMedia(payload.receiverIds, payload.filePath, payload.caption, payload.soundPath),
  );

  ipcMain.handle(
    "message:send",
    (
      _e,
      payload: {
        receiverId: string;
        messageId: string;
        durationMs?: number;
        delayMs?: number;
        audioDelayMs?: number;
        fadeInMs?: number;
        fadeOutMs?: number;
        layout?: {
          x: number;
          y: number;
          width: number;
          height: number;
          rotation?: number;
          objectFit?: string;
          opacity?: number;
        };
      },
    ) => {
      sendMessage(payload);
      return { ok: true };
    },
  );

  ipcMain.handle("dialog:pick-media", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const opts: Electron.OpenDialogOptions = {
      title: "Choose image, video, or audio",
      properties: ["openFile"],
      filters: [
        { name: "Media", extensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        { name: "Videos", extensions: ["mp4", "webm", "mov"] },
        { name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a"] },
      ],
    };
    const result =
      win && !win.isDestroyed() ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("dialog:pick-audio", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const opts: Electron.OpenDialogOptions = {
      title: "Choose sound file",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a", "aac"] }],
    };
    const result =
      win && !win.isDestroyed() ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  if (!(await tryRestoreSession())) {
    showLoginWindow();
  } else {
    startApp();
    scheduleStartupReconnect();
    // Stay in tray only — settings / friends / send are not opened automatically.
  }

  const protocolUrl = getProtocolUrlFromArgv(process.argv);
  if (protocolUrl) handleProtocolUrl(protocolUrl);
}

function startApp() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
    overlayQueue.setWindow(overlayWindow);
  }

  createTray(trayCallbacks(), connected);
  ensureMenuWindow();
  reconnectSocket();
  startConnectionWatchdog();
  void refreshMeProfile();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.whenReady().then(() => app.exit(0));
} else {
  app.on("second-instance", (_event, commandLine) => {
    const protocolUrl = getProtocolUrlFromArgv(commandLine);
    if (protocolUrl) {
      handleProtocolUrl(protocolUrl);
      if (!getAccessToken()) {
        showLoginWindow();
        loginWindow?.focus();
      }
      return;
    }
    // Stay in the tray. Do not pop the menu on a second launch.
    if (!getAccessToken()) {
      showLoginWindow();
      loginWindow?.focus();
    }
  });
  app.whenReady().then(bootstrap);
}

app.on("window-all-closed", () => {
  // Keep running in tray
});

app.on("before-quit", (event) => {
  if (hasReadyUpdate()) {
    event.preventDefault();
    installUpdate();
    return;
  }
  disconnectSocket();
  destroyTray();
});

// Compile preload separately - we'll copy preload to dist
// Actually preload needs to be compiled too. Let me add preload to tsc build.
