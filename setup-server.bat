@echo off
cd /d "%~dp0"
echo ============================================
echo  Screen Ping - one-time server setup
echo ============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo ERROR: Python not found. Install from https://python.org
  pause
  exit /b 1
)

cd server

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  python -m venv .venv
  if errorlevel 1 (
    echo ERROR: failed to create venv.
    pause
    exit /b 1
  )
)

echo Installing Python packages...
call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
  echo ERROR: pip install failed.
  pause
  exit /b 1
)

echo.
echo Setup complete. You can now run start-online.bat
pause
