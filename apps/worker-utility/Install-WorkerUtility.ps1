param(
  [string]$ArtifactDir,
  [string]$InstallRoot = 'D:\TigerIQ\Apps\WorkerUtility'
)
$ErrorActionPreference='Stop'
if(-not (Test-Path $ArtifactDir)){ throw 'ARTIFACT_DIR_NOT_FOUND' }
$exe=Join-Path $ArtifactDir 'TigerIQ.WorkerUtility.exe'
if(-not (Test-Path $exe)){ throw 'UTILITY_EXE_NOT_FOUND' }
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$target=Join-Path $InstallRoot ("Current-v1-$stamp")
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item (Join-Path $ArtifactDir '*') $target -Recurse -Force
$installedExe=Join-Path $target 'TigerIQ.WorkerUtility.exe'
$hash=(Get-FileHash $installedExe -Algorithm SHA256).Hash.ToLower()
$user=(Get-CimInstance Win32_ComputerSystem).UserName
if([string]::IsNullOrWhiteSpace($user)){ throw 'INTERACTIVE_USER_NOT_FOUND' }

# #826: WorkerUtility is the single owner of worker badges.
$legacyTask='TigerIQ Worker Status Compact'
$legacy=Get-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue
if($legacy){ Disable-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue | Out-Null }
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'powershell.exe' -or $_.Name -eq 'pwsh.exe') -and
  $_.CommandLine -like '*Worker-Status-Title.ps1*'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Get-Process TigerIQ.WorkerUtility -ErrorAction SilentlyContinue |
  Where-Object { $_.SessionId -ne 0 } |
  Stop-Process -Force -ErrorAction SilentlyContinue

$taskName='TigerIQ Worker Utility Bootstrap'
$action=New-ScheduledTaskAction -Execute $installedExe
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$live=Get-Process TigerIQ.WorkerUtility -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -ne 0 } | Select-Object -First 1
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
if(-not $live){ throw 'UTILITY_INTERACTIVE_SESSION_START_FAILED' }
@{ installedAt=(Get-Date).ToString('o'); target=$target; sha256=$hash; sessionId=$live.SessionId } | ConvertTo-Json | Set-Content (Join-Path $InstallRoot 'install-state.json') -Encoding UTF8
Write-Output ("INSTALLED|$target|$hash|SESSION=$($live.SessionId)")