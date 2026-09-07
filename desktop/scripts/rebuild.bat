@echo off
cd /d "%~dp0.."
echo Screen Ping - rebuild desktop app
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

echo Building...
call npm run build
if errorlevel 1 (
  echo ERROR: build failed.
  pause
  exit /b 1
)

echo.
echo Build OK. Run the app with: npm start
echo Or double-click: start-app.bat
pause
