@echo off
cd /d "%~dp0.."
echo Starting Screen Ping desktop app...
echo Make sure the server is running (start-local.bat) if you use localhost.
echo.

if not exist "dist\main\main.js" (
  echo dist not found - rebuilding first...
  call "%~dp0rebuild.bat"
  if errorlevel 1 exit /b 1
)

call npm start
