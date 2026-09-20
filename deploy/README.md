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

## Update-signing key

Desktop updates from 1.0.62 onward are authenticated with Ed25519. The private
key is `deploy/update-signing-private.pem`; it is intentionally ignored by Git.
Back it up in an encrypted password manager or on an offline encrypted drive
before publishing 1.0.62. Losing it means installed clients cannot verify future
updates. Never copy it to the VPS or commit it. The public key embedded in
`desktop/main/updatePublicKey.ts` is safe to publish.

Do not rotate this key after publishing without first shipping a client that
trusts both the old and new public keys.
