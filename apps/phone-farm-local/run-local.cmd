@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 20+ is required. This local app does not download dependencies.
  pause
  exit /b 1
)
start "TigerIQ Phone Farm local server" /min cmd /c "node app.mjs"
timeout /t 2 /nobreak >nul
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "--app=http://127.0.0.1:8765/"
) else (
  start "" "http://127.0.0.1:8765/"
)
exit /b 0
