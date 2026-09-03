@echo off
setlocal
set "SCRIPT=%~dp0Invoke-PC01-OneClickGoLive.ps1"
if not exist "%SCRIPT%" (
  echo BLOCKED: One-click PowerShell package is missing.
  exit /b 2
)
fltmc >nul 2>&1
if "%ERRORLEVEL%"=="0" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -ExecutePhysical
  exit /b %ERRORLEVEL%
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -PassThru -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%SCRIPT%"" -ExecutePhysical'; if ($null -eq $child) { exit 1 }; exit $child.ExitCode"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo BLOCKED: PC01 bootstrap exited with code %RC%.
exit /b %RC%
