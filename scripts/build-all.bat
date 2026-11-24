@echo off
setlocal
cd /d "%~dp0\.."
set "ROOT=%CD%"

echo [build] Electron desktop app...
cd /d "%ROOT%\desktop"
if not exist "node_modules\" call npm ci
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1

echo.
echo [build] Prepare Tauri renderer...
cd /d "%ROOT%\desktop-tauri"
call node scripts/prepare-renderer.mjs
if errorlevel 1 exit /b 1

echo.
echo Desktop builds prepared.
exit /b 0
