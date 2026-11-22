# Screen Ping desktop on Tauri

Rust replacement for the Electron desktop app (`desktop/`). It is being
built step by step; `desktop/` stays the shipping app until the switch.

| Step | Status |
|------|--------|
| 1. Overlay prototype (click-through, video/sound, above fullscreen-borderless) | done, tested by Mali |
| 2. Receiver: login, socket, ping queue, live draw, tray, menu, main window | **this build** |
| 3. Installer, auto-update, hand-over from the Electron app | todo |
| 4. Test with friends, then switch | todo |

## Layout

| Folder | What it is |
|--------|------------|
| `core/` | Rust crate with no UI: settings, HTTP API, Socket.IO, ping queue + draw layer. Ported from `desktop/main/*.ts`. |
| `src-tauri/` | Tauri app: windows, tray, menu popup, Win32 overlay tricks, DPAPI, autostart. |
| `src-tauri/src/bridge.js` | Recreates the Electron preload API, so `desktop/renderer` runs unchanged. |
| `scripts/prepare-renderer.mjs` | Copies `desktop/dist/renderer` to `dist/` and opens the pages' CSP to Tauri IPC. |

Ported file by file:

| Electron (`desktop/main`) | Tauri |
|---|---|
| `store.ts` | `core/src/settings.rs` (+ DPAPI in `src-tauri/src/win32.rs`) |
| `auth.ts`, `apiClient.ts`, `windows.ts` (token refresh) | `core/src/api.rs` |
| `socketClient.ts`, watchdog in `main.ts` | `core/src/socket.rs` |
| `overlayQueue.ts`, `drawOverlay.ts` | `core/src/overlay.rs` |
| `displayLayout.ts` | `core/src/displays.rs` |
| `win32Overlay.ts`, overlay parts of `windows.ts` | `src-tauri/src/win32.rs`, `src-tauri/src/host.rs` |
| `main.ts`, `windows.ts`, `tray.ts`, `appState.ts` | `src-tauri/src/app.rs`, `src-tauri/src/ipc.rs` |
| `preload.ts` | `src-tauri/src/bridge.js` |

Not ported yet (step 3): `updater.ts`, `versionCheck.ts`, `protocol.ts`
(`screenping://`), the update window. Settings and login from the Electron
app are not migrated: log in again in the Tauri build.

## Build

Windows, with Rust and Node installed:

```cmd
cd desktop && npm ci && npx vite build && cd ..
cd desktop-tauri
node scripts\prepare-renderer.mjs
npx @tauri-apps/cli@2 build    :: installer in src-tauri\target\release\bundle\nsis
```

CI (`.github/workflows/tauri-proto.yml`) runs the core tests on Linux and
builds the Windows installer as the `screen-ping-tauri` artifact.

For a dev build against a local server, set `SCREENPING_SERVER_URL`
(ignored by release builds) and run `npx @tauri-apps/cli@2 dev`.

## Core end-to-end check

Against a running server with two accepted friends `alice` / `bob`
(password `pass1234`):

```bash
cd desktop-tauri/core
SP_SERVER=http://127.0.0.1:8000 cargo run --example e2e
```

It logs in, connects with a refused token then recovers, uploads and sends an
image from bob to alice, checks alice's queue shows and acks it, reconnects,
and checks a revoked session reports expiry. `examples/resilience.rs` prints
connection changes while you restart the server.

## What to test in the Windows build

Quit the Electron Screen Ping first (both would receive the pings).

1. Log in (username/password, and "website" login).
2. The tray icon appears; left or right click opens the menu next to the cursor.
3. A friend sends an image, a video with sound, a sound alone, and a live drawing:
   all show, clicks pass through, sound plays, focus is not stolen.
4. Pause, go offline/online, pick another screen in settings.
5. Open the main window: friends list, send a ping from the app, compact mode.
6. Log out, log back in. Quit from the menu.
