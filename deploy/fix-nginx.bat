@echo off
title Screen Ping - Fix Nginx only
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-nginx.ps1"
if errorlevel 1 (
    echo.
    echo Fix failed.
    pause
    exit /b 1
)
pause
