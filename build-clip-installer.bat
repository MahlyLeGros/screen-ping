@echo off
cd /d "%~dp0screen-clip"
call npm install
call npm run dist
echo Installer output: screen-clip\release\
