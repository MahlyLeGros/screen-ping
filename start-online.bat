@echo off
cd /d "%~dp0"

echo ============================================
echo  Screen Ping - start online (server+ngrok)
echo ============================================
echo.

call "%~dp0scripts\launch-online-core.bat" %*
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo --------------------------------------------
echo  Keep both windows open (Server + ngrok).
echo  Send your friend the HTTPS URL above.
echo  Desktop Server URL = same URL, no trailing slash.
echo --------------------------------------------
echo.
echo Tip: rebuild website first:  start-online.bat build
echo.
pause
