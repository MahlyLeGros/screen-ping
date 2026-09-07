/**
 * Dev helper: opens one renderer page standalone with a mocked state so the UI
 * can be inspected without going through the real auth flow.
 *   npx electron scripts/preview-window.js menu
 */
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

const page = ["login", "app", "menu", "update"].find((name) => process.argv.includes(name)) || "login";

const sizes = {
  login: { width: 380, height: 442 },
  app: { width: 800, height: 520 },
  menu: { width: 278, height: 400 },
  update: { width: 380, height: 214 },
};

const mockState = {
  version: "1.0.44",
  packaged: true,
  username: "admin",
  userId: "user-1",
  serverUrl: "http://localhost:8000",
  connected: true,
  online: true,
  paused: false,
  launchAtLogin: true,
  alwaysOnTop: false,
  compact: false,
  overlayDisplayId: null,
  displays: [
    { id: 1, label: "Left — 1920×1080 · main", shortLabel: "Left", primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, label: "Center — 2560×1440", shortLabel: "Center", primary: false, bounds: { x: 1920, y: -180, width: 2560, height: 1440 } },
    { id: 3, label: "Right — 1920×1080", shortLabel: "Right", primary: false, bounds: { x: 4480, y: 0, width: 1920, height: 1080 } },
  ],
  update: { state: "idle" },
  latestVersion: "1.0.40",
  outdated: true,
};

app.whenReady().then(() => {
  ipcMain.handle("auth:get-saved-login", () => ({ username: "", password: "", remember: true }));
  ipcMain.handle("app:get-state", () => mockState);
  ipcMain.on("menu:hide", () => {});
  ipcMain.on("app:set", () => {});
  ipcMain.on("app:action", () => {});
  ipcMain.handle("friends:list", () => [
    {
      id: "f1",
      user_id: "u2",
      username: "alice",
      status: "accepted",
      is_online: true,
      last_active_at: new Date().toISOString(),
      direction: "accepted",
    },
    {
      id: "f2",
      user_id: "u3",
      username: "bob",
      status: "pending",
      is_online: false,
      direction: "incoming",
    },
  ]);
  ipcMain.handle("friends:request", () => ({ id: "f3", user_id: "u4", username: "new", status: "pending", is_online: false, direction: "outgoing" }));
  ipcMain.handle("friends:accept", () => ({}));
  ipcMain.handle("friends:decline", () => ({ ok: true }));
  ipcMain.handle("friends:remove", () => ({ ok: true }));
  ipcMain.handle("friends:block", () => ({ ok: true }));
  ipcMain.handle("friends:unblock", () => ({}));
  ipcMain.handle("dialog:pick-media", () => null);
  ipcMain.handle("dialog:pick-audio", () => null);
  ipcMain.handle("media:upload", () => []);
  ipcMain.handle("message:send", () => ({ ok: true }));

  const win = new BrowserWindow({
    ...sizes[page],
    frame: false,
    backgroundColor: "#030304",
    webPreferences: {
      preload: path.join(__dirname, "..", "dist", "main", "preload.js"),
      contextIsolation: true,
    },
  });

  ipcMain.on("menu:resize", (_event, { width, height }) => {
    const bounds = win.getBounds();
    win.setBounds({ ...bounds, width: Math.round(width), height: Math.round(height) });
  });

  win.loadFile(path.join(__dirname, "..", "dist", "renderer", `${page}.html`));

  // Replay a fake check -> download -> ready cycle so the progress UI can be seen.
  if (page === "update") {
    const total = 82 * 1024 * 1024;
    const steps = [
      { at: 600, update: { state: "checking" } },
      { at: 1800, update: { state: "available", version: "1.0.40" } },
      ...Array.from({ length: 20 }, (_, i) => ({
        at: 2600 + i * 350,
        update: {
          state: "downloading",
          percent: (i + 1) * 5,
          transferred: Math.round((total * (i + 1) * 5) / 100),
          total,
          bytesPerSecond: 3.4 * 1024 * 1024,
        },
      })),
      { at: 10200, update: { state: "ready", version: "1.0.40" } },
    ];
    for (const step of steps) {
      setTimeout(() => {
        mockState.update = step.update;
        if (!win.isDestroyed()) win.webContents.send("app:state", mockState);
      }, step.at);
    }
  }
});

app.on("window-all-closed", () => app.quit());
