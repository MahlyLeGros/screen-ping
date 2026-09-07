@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0publish-desktop.ps1"
pause
