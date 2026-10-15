@echo off
setlocal

cd /d "%~dp0"

REM Node/npm global shims often missing from PATH until Cursor/terminal is restarted.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%APPDATA%\npm\netlify.cmd" set "PATH=%APPDATA%\npm;%PATH%"

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

echo.
echo [1/2] Building netlify_dist from local data/ ...
python scripts\build_netlify.py
if %errorlevel% neq 0 (
    echo BUILD FAILED
    pause
    exit /b 1
)

echo.
echo [2/2] Deploy to Netlify production ...
where netlify >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo netlify CLI not found on PATH.
    echo Install once:  npm install -g netlify-cli --allow-scripts=netlify-cli,esbuild,unix-dgram,sharp
    echo Then close and reopen Cursor, or run:
    echo   set PATH=%%ProgramFiles%%\nodejs;%%APPDATA%%\npm;%%PATH%%
    echo   netlify login
    echo   netlify link
    echo.
    echo Build output is ready in netlify_dist\ — deploy manually when CLI is set up:
    echo   netlify deploy --prod --dir=netlify_dist
    pause
    exit /b 1
)

netlify deploy --prod --dir=netlify_dist
if %errorlevel% neq 0 (
    echo DEPLOY FAILED — run: netlify login ^&^& netlify link
    pause
    exit /b 1
)

echo.
echo Done. Enable Password protection / Visitor access in Netlify UI for this site.
pause
