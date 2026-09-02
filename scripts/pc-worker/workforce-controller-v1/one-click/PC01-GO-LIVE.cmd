@echo off
setlocal
set "SCRIPT=%~dp0Invoke-PC01-OneClickGoLive.ps1"
if not exist "%SCRIPT%" (
  echo BLOCKED: One-click PowerShell package is missing.
  exit /b 2
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%SCRIPT%"" -ExecutePhysical'"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo BLOCKED: PC01 bootstrap exited with code %RC%.
exit /b %RC%
