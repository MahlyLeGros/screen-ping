# Screen Ping Desktop

Public source for the Screen Ping Windows receiver and tray application. The installed client connects to the hosted platform at [screenping.xyz](https://screenping.xyz). The website and API live in the private [`MahlyLeGros/screen-ping-platform`](https://github.com/MahlyLeGros/screen-ping-platform) repository.

This repository contains the Electron client, the Tauri client, desktop build and release tools, and `shared/`. The desktop repository is the canonical source for `shared/`; changes to shared code must also be copied into the private platform repository.

## Build the Electron app

```powershell
cd desktop
npm ci
npm run build
npm start
```

For development with hot reload, run `npm run dev` from `desktop`. To create a Windows installer, run `npm run dist`; output is in `desktop/release/`.

## Build the Tauri app

The Tauri shell uses the renderer in `desktop/` and the Rust core in `desktop-tauri/`.

```powershell
cd desktop
npm ci
npm run build
cd ..\desktop-tauri
node scripts/prepare-renderer.mjs
npx tauri build
```

The GitHub Actions workflow tests the Rust core and builds the Windows installer.

## Publish a desktop update

1. Set the version in `desktop/package.json`.
2. Run `deploy/publish-desktop.bat` (or pass a CI-built setup installer).
3. The publisher signs the installer locally, publishes it under `https://screenping.xyz/desktop/updates/`, and writes the update manifests to the platform VPS data folder. The API reads those manifests through its read-only Docker mount.

The catalog source files are in `deploy/desktop-feed/`. Never commit the private update signing key or VPS credentials. The signing key stays local and is never uploaded to the VPS.

## Shared modules

`shared/` is copied into both repositories. Make changes here first, then copy the same change into the private platform repository.

## License

MIT. See [LICENSE](LICENSE).
