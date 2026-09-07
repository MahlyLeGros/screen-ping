@echo off
cd /d "%~dp0.."
echo Screen Ping - build Windows installer (.exe)
echo This can take a few minutes...
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found. Install Node.js from https://nodejs.org then reopen CMD.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run dist
if errorlevel 1 (
  echo.
  echo ERROR: installer build failed.
  echo If you see a symlink error, run CMD as Administrator or use rebuild.bat + npm start instead.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  Installer ready — double-click the .exe below
echo ============================================
for %%F in ("%~dp0..\release\Screen Ping Setup *.exe") do (
  echo   %%~fF
  start "" explorer /select,"%%~fF"
  goto :done
)
echo   (no .exe found in release\)
:done
echo.
echo Quit any old Screen Ping tray app before installing.
pause
