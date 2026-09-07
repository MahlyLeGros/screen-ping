@echo off
cd /d "%~dp0"
set "ROOT=%CD%"

echo ============================================
echo  Screen Ping - hebergement LOCAL (sans VPS)
echo ============================================
echo.

if not exist "%ROOT%\server\.venv\Scripts\uvicorn.exe" (
  echo ERROR: Python venv manquant.
  echo Lance une fois:  setup-server.bat
  pause
  exit /b 1
)

if /i "%~1"=="build" goto do_build
if not exist "%ROOT%\web\dist\index.html" goto do_build
goto skip_build

:do_build
echo [1/2] Build du site web...
cd /d "%ROOT%\web"
if not exist "node_modules\" call npm install
call npm run build
if errorlevel 1 (
  echo Build web echoue.
  pause
  exit /b 1
)
cd /d "%ROOT%"
echo.

:skip_build
rem Desktop app: pointer vers le serveur local
echo local> "%ROOT%\desktop\USE_LOCAL_SERVER"
echo [OK] Desktop forcera http://localhost:8000

echo [2/2] Demarrage API + site sur le port 8000...
start "Screen Ping - Local" cmd /k "%ROOT%\server\run-local.bat"

timeout /t 3 /nobreak >nul
start "" "http://localhost:8000"

echo.
echo --------------------------------------------
echo  Site:     http://localhost:8000
echo  Desktop:  relance l'app Screen Ping
echo            (elle utilisera localhost:8000)
echo.
echo  Amis a distance: utilise start-online.bat
echo  (ngrok gratuit) — localhost reste sur ton PC.
echo --------------------------------------------
echo.
pause
