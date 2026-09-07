@echo off
cd /d "%~dp0"

echo ============================================
echo  Screen Ping - start everything
echo  (rebuild web + desktop, server, ngrok, app)
echo ============================================
echo.

echo [1/4] Rebuilding web + desktop...
call "%~dp0scripts\build-all.bat"
if errorlevel 1 (
  echo.
  echo ERROR: build failed.
  pause
  exit /b 1
)

echo.
echo [2/4] Starting server + ngrok...
call "%~dp0scripts\launch-online-core.bat" nobuild
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo [3/4] Launching desktop app...
timeout /t 2 /nobreak >nul
start "Screen Ping - Desktop" cmd /k "cd /d "%~dp0desktop" && npm start"

echo.
echo [4/4] Done.
echo  - Website: use your ngrok HTTPS URL in the browser
echo  - Desktop:  same URL in Server URL (no trailing slash)
echo  - Keep Server + ngrok windows open
echo.
pause
