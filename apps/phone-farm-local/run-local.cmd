@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [TigerIQ] Node.js 20 or higher is required on this computer.
  pause
  exit /b 1
)
powershell -NoProfile -NonInteractive -Command "try {$r=Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 2;if($r.localOnly){exit 0}else{exit 2}}catch{exit 1}"
if errorlevel 2 (
  echo [TigerIQ] Local port 8765 is in use by a non-TigerIQ service.
  pause
  exit /b 2
)
if errorlevel 1 (
  start "TigerIQ Phone Farm local server" /min node app.mjs
  timeout /t 2 /nobreak >nul
)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "--app=http://127.0.0.1:8765/"
) else (
  start "" "http://127.0.0.1:8765/"
)
exit /b 0
