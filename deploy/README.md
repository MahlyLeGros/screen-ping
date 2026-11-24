# Desktop release tools

This folder contains the desktop update publisher and its tracked update catalog. Website and API deployment tools are maintained in the private `screen-ping-platform` repository.

| File | Purpose |
|---|---|
| `publish-desktop.bat` / `.ps1` | Sign and publish a desktop installer and update metadata |
| `desktop-feed/latest.json` | Current desktop release metadata |
| `desktop-feed/versions.json` | Supported upgrade versions |
| `bootstrap-update-feeds.py` | Generate Electron updater feeds from published installers |
| `deploy.config.example.ps1` | Example local VPS settings; copy to the ignored `deploy.config.ps1` |

The publisher expects `deploy.config.ps1` and the update-signing private key to be available locally. It signs the installer on this PC. The key is never copied to the VPS. Point `DeployRemotePath` in the local config at the platform checkout on the VPS so that manifests can be installed under `data/desktop-updates`.

Desktop releases publish the installer and Electron feeds to `/var/www/screenping/desktop/updates`, then publish `latest.json` and `versions.json` to both that static directory and the platform's read-only API data directory. The API endpoints stay unchanged.

Never commit real deploy credentials or the private signing key. The public verification key in `desktop/main/updatePublicKey.ts` is safe to publish.
