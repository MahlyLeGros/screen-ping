@echo off
title Screen Ping — Backup VPS
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-vps.ps1"
if errorlevel 1 (
    echo.
    echo Backup failed. See errors above.
    pause
    exit /b 1
)
pause
