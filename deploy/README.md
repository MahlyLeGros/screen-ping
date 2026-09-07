# Deploy / VPS

Scripts that talk to the production server (`screenping.xyz`).

| Script | Purpose |
|--------|---------|
| `deploy.bat` / `deploy.ps1` | Ship server + web to the VPS |
| `publish-desktop.bat` | Build installer and upload update feed |
| `update-vps.bat` | Quick VPS update |
| `backup-vps.bat` | Backup remote data |
| `fix-nginx.bat` / `fix-api.bat` | Repair nginx / API |
| `check-server.ps1` / `diagnose.ps1` / `debug-vps.ps1` | Diagnostics |
| `nginx-screenping.conf` | Nginx site config |
| `deploy.config.example.ps1` | Copy to `deploy.config.ps1` (gitignored) |

Copy `deploy.config.example.ps1` → `deploy.config.ps1` and fill in host/credentials before deploying.
