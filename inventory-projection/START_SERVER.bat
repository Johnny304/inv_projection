@echo off
setlocal

cd /d "%~dp0"

REM Prefer .venv (primary), then .venv-1
if exist "%~dp0..\.venv\Scripts\activate.bat" (
    call "%~dp0..\.venv\Scripts\activate.bat"
    echo Using .venv
) else if exist "%~dp0..\.venv-1\Scripts\activate.bat" (
    call "%~dp0..\.venv-1\Scripts\activate.bat"
    echo Using .venv-1
) else (
    echo WARNING: No .venv or .venv-1 found - using system Python
)

set HOST=127.0.0.1
set PORT=8780
set URL=http://%HOST%:%PORT%

echo.
echo Starting Inventory Collaboration Website...
echo URL: %URL%
echo Press Ctrl+C to stop.
echo.

start "" "%URL%"
python -m uvicorn app:app --host %HOST% --port %PORT% --reload
if %errorlevel% neq 0 pause
