@echo off
title Screen Ping - Fix API (avatar upload)
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-api.ps1"
if errorlevel 1 (
    echo.
    echo Fix failed.
    pause
    exit /b 1
)
pause
