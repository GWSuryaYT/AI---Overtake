@echo off
cd /d "c:\Users\surya\Desktop\workspace\Webapp Projects\AI - Overtake"

:: Check if virtual environment Python exists, otherwise fall back to system Python
if exist "backend\venv\Scripts\python.exe" (
    "backend\venv\Scripts\python.exe" runner.py
) else (
    python runner.py
)
pause
