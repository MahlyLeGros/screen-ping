@echo off
cd /d "%~dp0.."
set "ROOT=%CD%"
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
set "APP_EXE=%ROOT%\desktop\release\win-unpacked\Screen Ping.exe"

echo ============================================
echo  Screen Ping - test local (GUI + logo)
echo ============================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm introuvable.
  pause
  exit /b 1
)

if not exist "%ROOT%\brand\logo-source.png" (
  echo ERROR: brand\logo-source.png manquant.
  pause
  exit /b 1
)

if not exist "%ROOT%\server\.venv\Scripts\uvicorn.exe" (
  echo ERROR: Python venv manquant. Lance setup-server.bat une fois.
  pause
  exit /b 1
)

echo Ferme Screen Ping s'il tourne encore...
taskkill /F /IM "Screen Ping.exe" >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [1/5] Icons...
cd /d "%ROOT%\desktop"
call node scripts/gen-icons.js
if errorlevel 1 goto fail
cd /d "%ROOT%"
echo.

echo [2/5] Build web...
cd /d "%ROOT%\web"
if not exist "node_modules\" call npm install
call npm run build
if errorlevel 1 goto fail
if not exist "dist\index.html" (
  echo ERROR: web\dist\index.html manquant apres le build.
  goto fail
)
cd /d "%ROOT%"
echo.

echo [3/5] Pack desktop (icons stamped)...
cd /d "%ROOT%\desktop"
if not exist "node_modules\" call npm install
call npm run pack:dir
if errorlevel 1 goto fail
if not exist "%APP_EXE%" (
  echo ERROR: build desktop introuvable:
  echo   %APP_EXE%
  goto fail
)

echo local> "%ROOT%\desktop\USE_LOCAL_SERVER"
echo local> "%ROOT%\desktop\release\win-unpacked\USE_LOCAL_SERVER"
cd /d "%ROOT%"
echo.

echo [4/5] Restart serveur local...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do taskkill /F /PID %%P >nul 2>&1
timeout /t 2 /nobreak >nul
start "Screen Ping - Local" cmd /k "%ROOT%\server\run-local.bat"
timeout /t 6 /nobreak >nul
echo.

echo [5/5] Launch...
start "" "http://localhost:8000/"
start "" "%APP_EXE%"

echo.
echo --------------------------------------------
echo  Site:     http://localhost:8000
echo  Desktop:  %APP_EXE%
echo --------------------------------------------
echo.
pause
exit /b 0

:fail
echo.
echo ECHEC - vois les erreurs au-dessus.
pause
exit /b 1
