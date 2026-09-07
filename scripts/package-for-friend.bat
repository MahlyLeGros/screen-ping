@echo off
cd /d "%~dp0.."
echo Screen Ping - package for sharing
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found. Install Node.js from https://nodejs.org
  pause
  exit /b 1
)

echo [1/3] Building web dashboard...
cd web
call npm install
if errorlevel 1 goto fail
call npm run build
if errorlevel 1 goto fail
cd ..

echo [2/3] Building Windows installer...
cd desktop
if not exist "node_modules\" call npm install
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run dist
if errorlevel 1 goto fail
cd ..

echo [3/3] Creating share package in out\...
set OUT=%~dp0..\out\screen-ping-share
if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%"

for %%F in ("%~dp0..\desktop\release\Screen Ping Setup *.exe") do copy /y "%%~fF" "%OUT%\"
copy /y "%~dp0..\docs\FRIEND-SETUP.txt" "%OUT%\"

powershell -NoProfile -Command "Compress-Archive -Path '%OUT%\*' -DestinationPath '%~dp0..\out\screen-ping-share.zip' -Force"

echo.
echo Done!
echo   Folder: %OUT%
echo   Zip:    %~dp0..\out\screen-ping-share.zip
echo.
echo Send out\screen-ping-share.zip to your friend.
pause
exit /b 0

:fail
echo.
echo ERROR: packaging failed.
pause
exit /b 1
