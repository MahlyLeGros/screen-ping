@echo off
title Screen Ping — Deploy to VPS
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
if errorlevel 1 (
    echo.
    echo Deploy failed. See errors above.
    pause
    exit /b 1
)
pause
