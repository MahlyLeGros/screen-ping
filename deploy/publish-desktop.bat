@echo off
cd /d "%~dp0"
REM Drop the setup .exe (or the unzipped CI artifact folder) on this file to
REM publish it; run it alone to build here first (needs Rust).
powershell -ExecutionPolicy Bypass -File "%~dp0publish-desktop.ps1" -Installer "%~1"
pause
