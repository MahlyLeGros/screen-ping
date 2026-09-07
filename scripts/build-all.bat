@echo off
setlocal
cd /d "%~dp0\.."
set "ROOT=%CD%"

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found. Install Node.js from https://nodejs.org
  exit /b 1
)

echo [build] Web dashboard...
cd /d "%ROOT%\web"
if not exist "node_modules\" call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1

echo.
echo [build] Desktop app...
cd /d "%ROOT%\desktop"
if not exist "node_modules\" call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1

echo.
echo Build complete.
exit /b 0
