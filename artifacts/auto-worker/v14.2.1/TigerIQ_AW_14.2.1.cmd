@echo off
setlocal EnableExtensions
title TigerIQ Auto Worker 14.2.1 TEST CANDIDATE
set "TIQ_PS=%TEMP%\TigerIQ_AW_14.2.1_%RANDOM%%RANDOM%.ps1"
set "TIQ_URL=https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/387cfdfc8f7e4bb6f5d2171bf48bd5f58d07c63d/scripts/pc-worker/TigerIQ_AW_14.2.1_installer.ps1"
set "TIQ_SHA=228f23fdf9e071644186792a4ebf6115a73a96a60cd17bf6ec0aadef584ceaf2"
echo TigerIQ Auto Worker 14.2.1 - TEST CANDIDATE / PHYSICAL PENDING
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try{Invoke-WebRequest -UseBasicParsing -Uri $env:TIQ_URL -OutFile $env:TIQ_PS;exit 0}catch{Write-Host ('DOWNLOAD_FAIL: '+$_.Exception.Message);exit 21}"
if errorlevel 1 goto TIQ_FAIL
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash -Algorithm SHA256 -LiteralPath $env:TIQ_PS).Hash.ToLowerInvariant();if($h -ne $env:TIQ_SHA){Write-Host ('HASH_MISMATCH actual='+$h);exit 22};exit 0"
if errorlevel 1 goto TIQ_FAIL
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TIQ_PS%"
set "TIQ_RC=%ERRORLEVEL%"
del /q "%TIQ_PS%" >nul 2>nul
if not "%TIQ_RC%"=="0" goto TIQ_FAIL_CODE
echo.
echo PASS - candidate installed. Continue Chrome physical test.
pause
exit /b 0
:TIQ_FAIL
set "TIQ_RC=%ERRORLEVEL%"
:TIQ_FAIL_CODE
del /q "%TIQ_PS%" >nul 2>nul
echo.
echo FAIL - no fake PASS. Send this window or screenshot to Vy.
pause
exit /b %TIQ_RC%
