# Screen Ping

Windows tray app + web dashboard: approved friends can send images, videos, and sounds to your screen in real time.

This repository is the open-source code for [screenping.xyz](https://screenping.xyz). Licensed under the [MIT License](LICENSE).

**Do not commit** real emails, usernames, passwords, or deploy credentials. Copy `.env.example` and `deploy/deploy.config.example.ps1` and keep the filled-in files local.

## Folder map

| Folder | What it is |
|--------|------------|
| **`desktop/`** | Electron receiver app (overlay + tray) |
| **`screen-clip/`** | Electron instant-replay clipper (screen + audio buffer) |
| **`server/`** | FastAPI + Socket.IO backend |
| **`web/`** | React dashboard (send pings, friends) |
| **`shared/`** | Code shared by web + desktop caption UI |
| **`brand/`** | Source logo used to generate icons |
| **`deploy/`** | VPS deploy / nginx / publish desktop updates |
| **`scripts/`** | Build helpers (not needed every day) |
| **`docs/`** | Extra docs (friend setup text, etc.) |
| **`out/`** | Generated share zips (safe to delete) |

## Everyday starters (root)

| Script | What it does |
|--------|----------------|
| **`start-local.bat`** | API + site on `localhost:8000` (no ngrok) |
| **`start-online.bat`** | Server + ngrok public URL |
| **`start-all.bat`** | Rebuild web+desktop, then server+ngrok+app |
| **`setup-server.bat`** | First-time Python venv for the API |
| **`build-installer.bat`** | Build `desktop/release/Screen Ping Setup *.exe` |
| **`start-clip.bat`** | Install/build/run Screen Clip |
| **`build-clip-installer.bat`** | Build `screen-clip/release/Screen Clip Setup *.exe` |

Requires [ngrok](https://ngrok.com) on PATH for the online scripts.

## Desktop app

```cmd
cd desktop
rebuild.bat          :: npm install + build
start-app.bat        :: launch
build-installer.bat  :: Windows .exe installer
```

Or: `npm install` → `npm run build` → `npm start`  
Dev with hot reload: `npm run dev`

Installer output: `desktop/release/`

## Manual setup

### 1. Backend

```bash
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn run:app --reload --host 0.0.0.0 --port 8000
```

### 2. Web dashboard

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173

### 3. Desktop

```cmd
cd desktop
npm install
npm run build
npm start
```

## Publish / VPS

See **`deploy/`** — especially `deploy.bat` and `publish-desktop.bat`.

Auto-update feed: `https://screenping.xyz/desktop/updates/`

1. Bump `version` in `desktop/package.json`
2. `deploy\publish-desktop.bat`
3. `deploy\deploy.bat` if server/web changed too

## Extra scripts

| Script | Purpose |
|--------|---------|
| `scripts\build-all.bat` | Rebuild web + desktop only |
| `scripts\package-for-friend.bat` | Build installer + zip into `out/` |
| `scripts\test-logo.bat` | Pack desktop + local server to test icons |

## Troubleshooting

| Error | Fix |
|-------|-----|
| `'npm' is not recognized` | Install [Node.js LTS](https://nodejs.org), restart CMD |
| `Cannot find module` | `npm install` inside `desktop` or `web` |
| `dist\main\main.js` missing | `npm run build` in `desktop` |
| Installer / symlink error | `set CSC_IDENTITY_AUTO_DISCOVERY=false` then `npm run dist` |
| Login `fetch failed` | Start `start-local.bat` if the app uses `localhost:8000` |
| Update `app-update.yml` missing | Reinstall from a fresh `npm run dist` build |
