@echo off
setlocal
where node >nul 2>&1
if errorlevel 1 (
  echo [TigerIQ] Node.js 20+ is required. https://nodejs.org/
  exit /b 1
)
pushd "%~dp0"
echo [TigerIQ] Open http://127.0.0.1:4179/ in your browser.
echo [TigerIQ] Press Ctrl+C to stop the local audit.
node website-ui.mjs
set "code=%errorlevel%"
popd
exit /b %code%
