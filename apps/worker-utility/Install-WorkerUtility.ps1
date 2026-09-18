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

# #826 Layout 2: WorkerUtility is the single badge/control-surface owner.
# Decommission legacy overlays and half-height window keepers that conflict with
# the System Tray flyout + full-height Chrome architecture.
$legacyTasks=@(
  'TigerIQ Worker Status Compact',
  'TigerIQ Worker Window Keeper',
  'TigerIQ Worker Window Supervisor',
  'TigerIQ Worker Layout After Logon'
)
foreach($legacyTask in $legacyTasks){
  $legacy=Get-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue
  if($legacy){
    Stop-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $legacyTask -ErrorAction SilentlyContinue | Out-Null
  }
}
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'powershell.exe' -or $_.Name -eq 'pwsh.exe') -and
  ($_.CommandLine -like '*Worker-Status-Title.ps1*' -or
   $_.CommandLine -like '*Worker-Window-Keeper.ps1*' -or
   $_.CommandLine -like '*Worker-Window-Supervisor.ps1*' -or
   $_.CommandLine -like '*Ensure-Lock-All-Workers.ps1*')
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$oldInteractive = @(Get-Process TigerIQ.WorkerUtility -ErrorAction SilentlyContinue |
  Where-Object { $_.SessionId -ne 0 })
$oldInteractive | Stop-Process -Force -ErrorAction SilentlyContinue

# Never accept a stale Worker Utility as proof of a successful switch.
for($i=0; $i -lt 10; $i++){
  $stale = @(Get-Process TigerIQ.WorkerUtility -ErrorAction SilentlyContinue |
    Where-Object { $_.SessionId -ne 0 -and $oldInteractive.Id -contains $_.Id })
  if($stale.Count -eq 0){ break }
  Start-Sleep -Milliseconds 250
}
$stale = @(Get-Process TigerIQ.WorkerUtility -ErrorAction SilentlyContinue |
  Where-Object { $_.SessionId -ne 0 -and $oldInteractive.Id -contains $_.Id })
if($stale.Count -gt 0){ throw 'UTILITY_PREVIOUS_PROCESS_STILL_RUNNING' }

$taskName='TigerIQ Worker Utility Bootstrap'
$action=New-ScheduledTaskAction -Execute $installedExe
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force | Out-Null
try {
  Start-ScheduledTask -TaskName $taskName
  $live=$null
  for($i=0; $i -lt 12; $i++){
    $live = Get-CimInstance Win32_Process -Filter "Name='TigerIQ.WorkerUtility.exe'" |
      Where-Object { $_.SessionId -ne 0 -and [string]::Equals($_.ExecutablePath, $installedExe, [System.StringComparison]::OrdinalIgnoreCase) } |
      Select-Object -First 1
    if($live){ break }
    Start-Sleep -Milliseconds 250
  }
}
finally {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}
if(-not $live){ throw 'UTILITY_NEW_EXECUTABLE_NOT_RUNNING' }
@{ installedAt=(Get-Date).ToString('o'); target=$target; sha256=$hash; sessionId=$live.SessionId; processId=$live.ProcessId } | ConvertTo-Json | Set-Content (Join-Path $InstallRoot 'install-state.json') -Encoding UTF8
Write-Output ("INSTALLED|$target|$hash|SESSION=$($live.SessionId)|PID=$($live.ProcessId)")
