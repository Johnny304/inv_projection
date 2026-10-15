@echo off
setlocal EnableDelayedExpansion

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

set HOST=0.0.0.0
set PORT=8780
set LOCAL_URL=http://127.0.0.1:%PORT%

REM IPv4 + Wi-Fi name on the adapter that has the default gateway
set LAN_IP=
set WIFI_NAME=
for /f "usebackq tokens=1,2 delims=|" %%i in (`powershell -NoProfile -Command "$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1; if (-not $r) { exit 0 }; $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $r.ifIndex -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1; $p = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -eq $r.InterfaceAlias } | Select-Object -First 1; if ($ip) { '{0}|{1}' -f $ip.IPAddress, $(if ($p) { $p.Name } else { '' }) }"`) do (
    set LAN_IP=%%i
    set WIFI_NAME=%%j
)

echo.
echo Starting Inventory Projection ^(LAN share^)...
echo Bind: %HOST%:%PORT%
echo This PC:  %LOCAL_URL%
if defined LAN_IP (
    if defined WIFI_NAME (
        echo Wi-Fi:    %WIFI_NAME%
    )
    echo Same WiFi: http://%LAN_IP%:%PORT%
    echo Colleagues must join that exact Wi-Fi name, then open the Same WiFi URL.
    echo Guest SSIDs often block PC-to-PC. If it still fails, use Netlify.
) else (
    echo Same WiFi: ^(could not detect LAN IP — run ipconfig and use your IPv4 Address^)
)
echo Close START_SERVER.bat first if it is still running ^(localhost-only bind^).
echo Keep this window open while others use the site.
echo Press Ctrl+C to stop.
echo.

start "" "%LOCAL_URL%"
python -m uvicorn app:app --host %HOST% --port %PORT% --reload
if %errorlevel% neq 0 pause
