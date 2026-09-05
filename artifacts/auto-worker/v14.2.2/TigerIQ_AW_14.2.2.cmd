@echo off
setlocal EnableExtensions
title TigerIQ Auto Worker 14.2.2 TEST CANDIDATE
set "TIQ_PS=%TEMP%\TigerIQ_AW_14.2.2_%RANDOM%%RANDOM%.ps1"
set "TIQ_URL=https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/8f0a45c57588a9abb846192517240fb21153f5de/scripts/pc-worker/TigerIQ_AW_14.2.2_installer.ps1"
set "TIQ_SHA=57be6bcfea2cea8afb375842b4b825d13689b7e59afc9bf6e41e7e1b8109fc2e"
echo TigerIQ Auto Worker 14.2.2 - TEST CANDIDATE / PHYSICAL PENDING
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try{Invoke-WebRequest -UseBasicParsing -Uri $env:TIQ_URL -OutFile $env:TIQ_PS;exit 0}catch{Write-Host ('DOWNLOAD_FAIL: '+$_.Exception.Message);exit 21}"
if errorlevel 1 goto TIQ_FAIL
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash -Algorithm SHA256 -LiteralPath $env:TIQ_PS).Hash.ToLowerInvariant();if($h -ne $env:TIQ_SHA){Write-Host ('HASH_MISMATCH actual='+$h);exit 22};exit 0"
if errorlevel 1 goto TIQ_FAIL
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TIQ_PS%"
set "TIQ_RC=%ERRORLEVEL%"
del /q "%TIQ_PS%" >nul 2>nul
if "%TIQ_PREFLIGHT_ONLY%"=="1" exit /b %TIQ_RC%
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
