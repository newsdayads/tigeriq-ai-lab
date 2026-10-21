@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem pushd supports local and UNC paths; popd restores the working directory.
pushd "%~dp0" 2>nul
if errorlevel 1 (
  echo ERROR: Cannot access the benchmark folder.
  exit /b 2
)
where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 20+ is not available on PATH.
  popd
  exit /b 2
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo ERROR: Node.js 20+ required. Found:
  node --version
  popd
  exit /b 2
)
node run-demo.mjs
set "STATUS=%ERRORLEVEL%"
if "%STATUS%"=="0" (
  echo PASS: scorer benchmark 0/3 baseline to 3/3 reference solutions.
) else (
  echo FAIL: scorer benchmark exited with code %STATUS%.
)
popd
exit /b %STATUS%
