@echo off
cd /d "%~dp0screen-clip"
call npm install
call npm run build
call npm start
