@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [TigerIQ] Node.js 20 or higher is required.
  pause
  exit /b 1
)
powershell -NoProfile -NonInteractive -Command "try{$r=Invoke-RestMethod 'http://127.0.0.1:8765/api/health' -TimeoutSec 2;if($r.localOnly){exit 0}else{exit 2}}catch{exit 1}"
if errorlevel 2 (
  echo [TigerIQ] Port 8765 is occupied by another process.
  pause
  exit /b 2
)
if errorlevel 1 (
  start "TigerIQ background service" powershell.exe -NoProfile -WindowStyle Hidden -File "%~dp0run-hidden.ps1"
  timeout /t 2 /nobreak >nul
)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "--app=http://127.0.0.1:8765/"
) else (
  start "" "http://127.0.0.1:8765/"
)
exit /b 0
