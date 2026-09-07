@echo off
REM Quick manual checklist — for full auto deploy use deploy.bat instead.
setlocal
cd /d "%~dp0.."

echo === Screen Ping VPS update ===
echo.
echo For automatic deploy (build + upload + docker rebuild), run:
echo   deploy\deploy.bat
echo.
echo [1/3] Building web...
cd web
call npm run build
if errorlevel 1 exit /b 1
cd ..

echo.
echo [2/3] Copy these folders to the VPS with WinSCP
echo         (host/user: values from deploy\deploy.config.ps1):
echo   LOCAL  server\app          -^>  ~/screen-ping/server/app/
echo   LOCAL  web\dist\*         -^>  ~/screen-ping/web/dist/
echo.
echo Or with OpenSSH scp from this folder (replace USER and HOST):
echo   scp -r server\app USER@HOST:~/screen-ping/server/
echo   scp -r web\dist\* USER@HOST:~/screen-ping/web/dist/
echo.

echo [3/3] On the VPS (SSH), rebuild the server container:
echo   ssh USER@HOST
echo   cd ~/screen-ping
echo   docker compose up -d --build
echo.
echo Verify avatar API (should print JSON with avatar_upload:true):
echo   curl -s https://screenping.xyz/api/media/capabilities
echo.
echo Then hard-refresh the site: Ctrl+F5
pause
