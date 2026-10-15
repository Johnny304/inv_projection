@echo off
REM Allow LAN clients to reach Inventory Projection on TCP 8780.
REM Right-click -> Run as administrator (once). Office PCs use the Domain profile.

echo.
echo ========================================
echo ALLOW FIREWALL - Inventory Projection
echo ========================================
echo.
echo This allows inbound TCP port 8780 on Domain/Private
echo and turns off the local python.exe inbound BLOCK
echo (that block stops colleagues from opening the LAN URL).
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Administrator rights required.
    echo         Right-click ALLOW_FIREWALL.bat - Run as administrator
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -Command "Get-NetFirewallRule -DisplayName 'python.exe' -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } | Disable-NetFirewallRule"
if %errorlevel% equ 0 (
    echo [OK] Disabled local python.exe inbound Block rules
) else (
    echo [WARN] Could not disable python.exe Block rules
)

netsh advfirewall firewall delete rule name="Inventory Projection LAN 8780" >nul 2>&1
netsh advfirewall firewall add rule name="Inventory Projection LAN 8780" dir=in action=allow protocol=TCP localport=8780 profile=domain,private
if %errorlevel% equ 0 (
    echo [OK] Port 8780 allowed on Domain and Private
) else (
    echo [ERROR] Failed to add the 8780 allow rule
)

echo.
echo Done. You only need to run this once unless IT resets firewall policy.
echo Then keep START_SERVER_LAN.bat running and share the printed Same WiFi URL.
echo.
pause
