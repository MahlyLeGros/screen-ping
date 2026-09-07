import { app, BrowserWindow, screen } from "electron";
import path from "path";
import { labelDisplays } from "./displayLayout";
import store, { setStoredValue } from "./store";
import { ensureOverlayShown } from "./win32Overlay";
import { getAssetPath, loadAppIcon } from "./assetsPath";

/** Dev server only when explicitly started via `npm run dev` (--vite flag). */
const useViteDev = !app.isPackaged && process.argv.includes("--vite");

function getOverlayDisplay() {
  const displays = screen.getAllDisplays();
  const savedId = store.get("overlayDisplayId");
  if (savedId !== null) {
    const match = displays.find((display) => display.id === savedId);
    if (match) return match;
  }
  return screen.getPrimaryDisplay();
}

export function getOverlayDisplayLabel(display: Electron.Display, _index: number) {
  const labeled = labelDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
  return labeled.find((item) => item.id === display.id)?.label ?? "This screen";
}

export function setOverlayDisplayId(displayId: number) {
  store.set("overlayDisplayId", displayId);
}

/**
 * Windows hides the taskbar when any topmost window covers a monitor exactly
 * (especially a secondary one). One pixel short breaks that fullscreen check
 * without a visible gap.
 */
function overlayScreenRect(): Electron.Rectangle {
  const { x, y, width, height } = getOverlayDisplay().bounds;
  return { x, y, width, height: Math.max(1, height - 1) };
}

const PARKED_OVERLAY_BOUNDS: Electron.Rectangle = { x: -32000, y: -32000, width: 1, height: 1 };

/** Hide and move off-screen so an idle overlay cannot steal the taskbar. */
export function parkOverlayWindow(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  win.setOpacity(0);
  if (win.isAlwaysOnTop()) win.setAlwaysOnTop(false);
  const current = win.getBounds();
  const parked = PARKED_OVERLAY_BOUNDS;
  if (
    current.x !== parked.x ||
    current.y !== parked.y ||
    current.width !== parked.width ||
    current.height !== parked.height
  ) {
    win.setBounds(parked);
  }
}

export function positionOverlayWindow(win: BrowserWindow) {
  const next = overlayScreenRect();
  const current = win.getBounds();
  if (
    current.x !== next.x ||
    current.y !== next.y ||
    current.width !== next.width ||
    current.height !== next.height
  ) {
    win.setBounds(next);
  }
}

export function applyOverlayTopMost(win: BrowserWindow, force = false) {
  if (process.platform === "win32") {
    if (force) {
      win.setAlwaysOnTop(false);
    }
    win.setAlwaysOnTop(true, "screen-saver", 2);
  } else if (process.platform === "darwin") {
    win.setAlwaysOnTop(true, "screen-saver");
  } else {
    win.setAlwaysOnTop(true);
  }

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setFullScreenable(false);
}

/** Prepare overlay for display (position + top-most + show). */
export function showOverlayWindow(win: BrowserWindow) {
  positionOverlayWindow(win);
  applyOverlayTopMost(win);
  if (!win.isVisible()) {
    win.showInactive();
  }
}

/** Light check while ping is on screen — no moveTop, no setBounds. */
export function reinforceOverlayWindow(win: BrowserWindow) {
  ensureOverlayShown(win);
}

/**
 * Click-through only. `forward: true` subclasses the window to relay mouse
 * messages, which makes the cursor flicker in every other window of the app
 * (electron#48035). The overlay has no pointer handlers, so it is not needed.
 */
function configureOverlayInputPassthrough(win: BrowserWindow) {
  win.setIgnoreMouseEvents(true);
}

export const MAIN_WINDOW_SIZE = { width: 800, height: 480 };
export const COMPACT_WINDOW_WIDTH = 690;

/** Floor for the card grid; below this the body scrolls instead of squeezing cards. */
export const FULL_MIN_HEIGHT = 420;
const COMPACT_MIN_HEIGHT = 120;

function applyWindowIcon(win: BrowserWindow, appIcon: Electron.NativeImage) {
  if (!appIcon.isEmpty()) {
    win.setIcon(appIcon);
  }
}

function loadRenderer(win: BrowserWindow, page: "login" | "app" | "overlay" | "menu" | "update") {
  if (useViteDev) {
    win.loadURL(`http://localhost:5174/${page}.html`);
    return;
  }
  win.loadFile(path.join(__dirname, `../renderer/${page}.html`));
}

export function createLoginWindow(): BrowserWindow {
  const appIcon = loadAppIcon();
  const win = new BrowserWindow({
    title: "Screen Ping",
    width: 380,
    height: 560,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: "#030304",
    autoHideMenuBar: true,
    icon: appIcon.isEmpty() ? getAssetPath("icon.ico") : appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  applyWindowIcon(win, appIcon);
  win.once("ready-to-show", () => win.show());
  loadRenderer(win, "login");

  return win;
}

export function createMainWindow(): BrowserWindow {
  const appIcon = loadAppIcon();
  const compact = store.get("compact");
  const win = new BrowserWindow({
    title: "Screen Ping",
    width: compact ? COMPACT_WINDOW_WIDTH : MAIN_WINDOW_SIZE.width,
    height: compact ? 132 : MAIN_WINDOW_SIZE.height,
    minWidth: 560,
    minHeight: compact ? COMPACT_MIN_HEIGHT : FULL_MIN_HEIGHT,
    frame: false,
    roundedCorners: true,
    show: false,
    backgroundColor: "#030304",
    autoHideMenuBar: true,
    skipTaskbar: false,
    icon: appIcon.isEmpty() ? getAssetPath("icon.ico") : appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  applyWindowIcon(win, appIcon);
  win.setAlwaysOnTop(store.get("alwaysOnTop"));
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
  loadRenderer(win, "app");

  return win;
}

export function createUpdateWindow(): BrowserWindow {
  const appIcon = loadAppIcon();
  const win = new BrowserWindow({
    title: "Screen Ping",
    width: 380,
    height: 214,
    resizable: false,
    frame: false,
    roundedCorners: true,
    show: false,
    backgroundColor: "#030304",
    autoHideMenuBar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    icon: appIcon.isEmpty() ? getAssetPath("icon.ico") : appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  applyWindowIcon(win, appIcon);
  win.setAlwaysOnTop(true);
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
  loadRenderer(win, "update");

  return win;
}

export function createMenuWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: "Screen Ping",
    width: 278,
    height: 360,
    frame: false,
    backgroundColor: "#06060a",
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, "pop-up-menu");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadRenderer(win, "menu");

  return win;
}

/**
 * Places the popup just above the click point, centered horizontally on it.
 * Tray icon bounds are ignored — in the overflow flyout they refer to the
 * hidden taskbar slot, not where the user actually clicked.
 */
export function positionMenuWindow(win: BrowserWindow, anchor?: Electron.Point | null) {
  const point = anchor ?? screen.getCursorScreenPoint();
  const work = screen.getDisplayNearestPoint(point).workArea;
  const { width, height } = win.getBounds();
  const gap = 8;

  // Bottom edge of the menu sits just above the click (centre of the icon).
  let x = point.x - Math.round(width / 2);
  let y = point.y - height - gap;

  const minX = work.x + gap;
  const maxX = work.x + work.width - width - gap;
  const minY = work.y + gap;
  const maxY = work.y + work.height - height - gap;

  x = Math.round(Math.max(minX, Math.min(x, maxX)));
  y = Math.round(Math.max(minY, Math.min(y, maxY)));

  win.setBounds({ x, y, width, height });
}

/** Resize between the card grid and the compact pill strip, keeping the window anchored. */
export function applyWindowMode(win: BrowserWindow, compact: boolean) {
  const [x, y] = win.getPosition();
  const width = compact ? COMPACT_WINDOW_WIDTH : MAIN_WINDOW_SIZE.width;
  const height = compact ? win.getBounds().height : MAIN_WINDOW_SIZE.height;
  win.setMinimumSize(560, compact ? COMPACT_MIN_HEIGHT : FULL_MIN_HEIGHT);
  win.setResizable(!compact);
  win.setBounds({ x, y, width, height }, false);
}

export function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: "Screen Ping",
    x: PARKED_OVERLAY_BOUNDS.x,
    y: PARKED_OVERLAY_BOUNDS.y,
    width: PARKED_OVERLAY_BOUNDS.width,
    height: PARKED_OVERLAY_BOUNDS.height,
    type: process.platform === "win32" ? "toolbar" : undefined,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  configureOverlayInputPassthrough(win);
  loadRenderer(win, "overlay");

  return win;
}

export type RefreshResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "no_refresh" | "unauthorized" | "network" };

export async function refreshAccessToken(): Promise<RefreshResult> {
  const refresh = store.get("refreshToken");
  const serverUrl = store.get("serverUrl");
  if (!refresh) return { ok: false, reason: "no_refresh" };

  try {
    const res = await fetch(`${serverUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ScreenPing-Client": "desktop",
      },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "unauthorized" };
    }
    if (!res.ok) {
      return { ok: false, reason: "network" };
    }
    const data = await res.json();
    if (!data?.access_token) return { ok: false, reason: "network" };
    store.set("accessToken", data.access_token);
    if (data.refresh_token) setStoredValue("refreshToken", data.refresh_token);
    return { ok: true, accessToken: data.access_token };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export function getAccessToken(): string | null {
  return store.get("accessToken");
}

export function getServerUrl(): string {
  return store.get("serverUrl");
}

export function isPaused(): boolean {
  return store.get("paused");
}

export function isOnline(): boolean {
  return store.get("online");
}
