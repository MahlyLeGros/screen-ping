# Screen Ping desktop on Tauri

Rust replacement for the Electron desktop app (`desktop/`). From 1.1.0 this
is the app that ships: `desktop/` keeps the pages (`desktop/renderer`, used
unchanged) and the version number (`desktop/package.json`).

| Step | Status |
|------|--------|
| 1. Overlay prototype (click-through, video/sound, above fullscreen-borderless) | done, tested by Mali |
| 2. Receiver: login, socket, ping queue, live draw, tray, menu, main window | done, tested by Mali |
| 3. Installer, auto-update, hand-over from the Electron app | **this build** |
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
| `updater.ts`, `updateFeed.ts`, `updateSignature.ts`, `versionCheck.ts` | `core/src/updater.rs`, update parts of `app.rs` |
| `protocol.ts` (`screenping://update`) | `app.rs` (`handle_protocol_args`), `win32.rs` (`register_protocol`) |
| `userData.ts` + `store.ts` (taking over Electron's login) | `core/src/electron_import.rs`, `src-tauri/src/migrate.rs` |

## Moving people off Electron

Nothing new is needed on the Electron side: 1.0.73 updates to this app on
its own.

1. `deploy\publish-desktop.bat` publishes this installer as
   `Screen Ping Setup X.Y.Z.exe` with the usual `.sig` and `latest.yml`.
2. Electron's updater sees a newer version, downloads it, checks its hash and
   Ed25519 signature, and runs it with `--updated /S --force-run`.
3. The installer hook (`src-tauri/nsis/hooks.nsh`) silently uninstalls the
   Electron app (it keeps `%APPDATA%\screen-ping-desktop`), removes its
   start-at-login entry and the old "Screen Ping Tauri" test build, installs,
   and starts the new app.
4. On first launch the app reads Electron's `config.json`, opens its refresh
   token (DPAPI key from Electron's `Local State`, then AES-GCM), and stores
   it again with its own DPAPI box: people stay signed in, with the same
   volume, screen and options.

After that, this app updates itself the same way (same server endpoints, same
signing key), starting the installer with `/S /UPDATE /R`.

## Publishing

On the PC that has `deploy\deploy.config.ps1` and
`deploy\update-signing-private.pem`:

1. Bump `desktop/package.json` and push; wait for the "Tauri desktop app"
   workflow and download its `screen-ping-tauri` artifact.
2. Drop the unzipped artifact (or its `*-setup.exe`) on
   `deploy\publish-desktop.bat`. Run it alone to build locally instead
   (needs Rust).
3. Commit the updated `server/app/desktop/latest.json` and `versions.json`.

The script refuses an installer whose version differs from
`desktop/package.json`.

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

Hand-over from Electron (before publishing): with the Electron 1.0.73 app
installed and logged in, run the new `Screen Ping_X_x64-setup.exe` (a normal
double-click, or `/S --force-run` to do exactly what Electron's updater does).
Electron should disappear (tray, Start menu, Apps list), the new app should
start in the tray already logged in, and a reboot should start only the new app.

1. Log in (username/password, and "website" login).
2. The tray icon appears; left or right click opens the menu next to the cursor.
3. A friend sends an image, a video with sound, a sound alone, and a live drawing:
   all show, clicks pass through, sound plays, focus is not stolen.
4. Pause, go offline/online, pick another screen in settings.
5. Open the main window: friends list, send a ping from the app, compact mode.
6. Log out, log back in. Quit from the menu.
