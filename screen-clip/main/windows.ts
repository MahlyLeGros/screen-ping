import { BrowserWindow, screen } from "electron";
import path from "path";
import { loadAppIcon } from "./assetsPath";

const useViteDev = !require("electron").app.isPackaged && process.argv.includes("--vite");

function rendererUrl(page: "app" | "menu"): string {
  if (useViteDev) return `http://localhost:5175/${page}.html`;
  return `file://${path.join(__dirname, "..", "renderer", `${page}.html`)}`;
}

let settingsWindow: BrowserWindow | null = null;
let menuWindow: BrowserWindow | null = null;

export function getSettingsWindow() {
  return settingsWindow;
}

export function getMenuWindow() {
  return menuWindow;
}

export function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 860,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    show: false,
    frame: false,
    backgroundColor: "#030304",
    icon: loadAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void settingsWindow.loadURL(rendererUrl("app"));
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  return settingsWindow;
}

export function ensureMenuWindow(): BrowserWindow {
  if (menuWindow && !menuWindow.isDestroyed()) return menuWindow;

  menuWindow = new BrowserWindow({
    width: 278,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#06060a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  void menuWindow.loadURL(rendererUrl("menu"));
  // Delay hide so button clicks fire before blur closes the popup (Windows tray UX).
  let blurTimer: NodeJS.Timeout | null = null;
  menuWindow.on("blur", () => {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      if (menuWindow && !menuWindow.isDestroyed() && !menuWindow.isFocused()) {
        menuWindow.hide();
      }
    }, 180);
  });
  menuWindow.on("focus", () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
  });
  menuWindow.on("closed", () => {
    menuWindow = null;
  });
  return menuWindow;
}

export function positionMenuWindow(win: BrowserWindow, anchor?: { x: number; y: number }) {
  const point = anchor ?? screen.getCursorScreenPoint();
  const work = screen.getDisplayNearestPoint(point).workArea;
  const [width, height] = win.getSize();
  let x = Math.round(point.x - width / 2);
  let y = Math.round(point.y - height - 8);
  x = Math.min(Math.max(work.x + 8, x), work.x + work.width - width - 8);
  y = Math.min(Math.max(work.y + 8, y), work.y + work.height - height - 8);
  win.setPosition(x, y, false);
}

export function revealMenuWindow(anchor?: { x: number; y: number }) {
  const win = ensureMenuWindow();
  positionMenuWindow(win, anchor);
  win.show();
  win.focus();
}

export function hideMenuWindow() {
  if (menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible()) {
    menuWindow.hide();
  }
}

export function resizeMenuWindow(width: number, height: number) {
  const win = ensureMenuWindow();
  win.setSize(Math.round(width), Math.round(height), false);
}
