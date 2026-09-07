@echo off
cd /d "%~dp0"
call .venv\Scripts\activate.bat
set SERVE_SPA=true
echo.
echo  Site + API:  http://localhost:8000
echo  Garde cette fenetre ouverte.
echo.
uvicorn run:app --host 0.0.0.0 --port 8000
