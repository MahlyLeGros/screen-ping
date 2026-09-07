@echo off
REM Thin wrapper — real script lives in scripts\
cd /d "%~dp0"
call "%~dp0scripts\start-app.bat"
