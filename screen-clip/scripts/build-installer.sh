#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run pack:dir
# Remove broken stub if present
rm -f "release/Screen Clip-1.0.2-win.exe" "release/ScreenClip-Setup-1.0.2.exe"
makensis -V2 scripts/screen-clip.nsi
# Also zip portable
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win zip
ls -lah release/ScreenClip-Setup-1.0.2.exe release/*1.0.2*.zip 2>/dev/null || ls -lah release/
