# Desktop (Electron)

Receiver app: tray menu, settings window, fullscreen overlay.

## Layout

```
desktop/
  main/          Electron main process (windows, updater, socket…)
  renderer/      UI pages (app, login, menu, overlay, update)
  assets/        Icons / tray images
  scripts/       Build helpers + bats
  release/       Installer output (generated)
  dist/          Compiled JS (generated)
```

## Commands

| Action | Script or npm |
|--------|----------------|
| Rebuild | `rebuild.bat` or `npm run build` |
| Run | `start-app.bat` or `npm start` |
| Dev | `npm run dev` |
| Installer | `build-installer.bat` or `npm run dist` |
| Preview a page | `npm run preview -- update` |

Thin `.bat` files in this folder just call `scripts\…` so double-click still works.
