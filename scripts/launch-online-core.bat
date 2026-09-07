@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0\.."
set "ROOT=%CD%"

if /i "%~1"=="build" set DO_BUILD=1
if /i "%~2"=="build" set DO_BUILD=1
if /i "%~1"=="nobuild" set NO_BUILD=1
if /i "%~2"=="nobuild" set NO_BUILD=1

where ngrok >nul 2>&1
if errorlevel 1 (
  echo ERROR: ngrok not found. Install from https://ngrok.com and add it to PATH.
  exit /b 1
)

if not exist "%ROOT%\server\.venv\Scripts\uvicorn.exe" (
  echo ERROR: Python venv missing.
  echo Run setup once:  setup-server.bat
  exit /b 1
)

if defined NO_BUILD goto skip_build
if defined DO_BUILD goto do_build
if not exist "%ROOT%\web\dist\index.html" goto do_build
goto skip_build

:do_build
echo [1/3] Building web dashboard...
cd /d "%ROOT%\web"
if not exist "node_modules\" call npm install
call npm run build
if errorlevel 1 exit /b 1
cd /d "%ROOT%"
echo.

:skip_build
echo [2/3] Starting backend on port 8000...
start "Screen Ping - Server" cmd /k "cd /d "%ROOT%\server" && .venv\Scripts\activate && echo Server: http://localhost:8000 && uvicorn run:app --host 0.0.0.0 --port 8000"

echo Waiting for server...
timeout /t 3 /nobreak >nul

echo [3/3] Starting ngrok tunnel...
start "Screen Ping - ngrok" cmd /k "ngrok http 8000"

echo Waiting for ngrok public URL...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\show-ngrok-url.ps1"
exit /b 0
