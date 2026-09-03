param(
  [string]$Branch = 'wo196/pc01-command-center-ui-v2',
  [int]$Port = 8787,
  [Parameter(Mandatory=$true)][string]$CommandHost,
  [Parameter(Mandatory=$true)][string]$GhPath,
  [Parameter(Mandatory=$true)][string]$GitPath,
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$NpmPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$runtimeDir = 'F:\TigerIQ\CommandCenter'
$updaterScript = Join-Path $runtimeDir 'auto-update-command-center.ps1'
$wrapperScript = Join-Path $runtimeDir 'run-auto-update-command-center.ps1'
$statePath = Join-Path $runtimeDir 'auto-update-state.json'
$tokenPath = 'F:\TigerIQ\Secrets\github-command-center.token'
$updaterTaskName = 'TigerIQ Command Center Updater'
$commandTaskName = 'TigerIQ Command Center'

function Fail([string]$Code,[string]$Message){ Write-Error "$Code`: $Message"; exit 1 }

Write-Host '[10%] UPDATER RUNTIME PRECHECK' -ForegroundColor Cyan
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){ Fail 'ADMIN_REQUIRED' 'Administrator permission is required.' }
if($Port -lt 1024 -or $Port -gt 65535){ Fail 'INVALID_PORT' 'Port out of range.' }
if($CommandHost -notmatch '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$' -and $CommandHost -ne '127.0.0.1'){ Fail 'UNSAFE_COMMAND_HOST' $CommandHost }
foreach($p in @($GhPath,$GitPath,$NodePath,$NpmPath,$updaterScript,$tokenPath)){ if(-not (Test-Path -LiteralPath $p)){ Fail 'REQUIRED_PATH_MISSING' $p } }

Write-Host '[25%] BUILD SYSTEM TOOLCHAIN WRAPPER' -ForegroundColor Cyan
$powershellDir = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0'
$powershellExe = Join-Path $powershellDir 'powershell.exe'
if(-not (Test-Path -LiteralPath $powershellExe)){ Fail 'POWERSHELL_NOT_FOUND' $powershellExe }
$toolDirs = @(
  (Split-Path -Parent $GhPath),
  (Split-Path -Parent $GitPath),
  (Split-Path -Parent $NodePath),
  (Split-Path -Parent $NpmPath),
  $powershellDir,
  "$env:SystemRoot\System32",
  $env:SystemRoot
) | Where-Object { $_ } | Select-Object -Unique
$runtimePath = ($toolDirs -join ';').Replace("'","''")
$updaterEscaped = $updaterScript.Replace("'","''")
$branchEscaped = $Branch.Replace("'","''")
$hostEscaped = $CommandHost.Replace("'","''")
$powershellEscaped = $powershellExe.Replace("'","''")
$wrapper = @"
`$ErrorActionPreference = 'Stop'
`$env:PATH = '$runtimePath'
& '$powershellEscaped' -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '$updaterEscaped' -Branch '$branchEscaped' -Port $Port -CommandHost '$hostEscaped'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($wrapperScript,$wrapper,(New-Object Text.UTF8Encoding($false)))

Write-Host '[40%] REGISTER SYSTEM UPDATER' -ForegroundColor Cyan
$previousInfo = Get-ScheduledTaskInfo -TaskName $updaterTaskName -ErrorAction SilentlyContinue
$previousLastRun = if($previousInfo){ $previousInfo.LastRunTime } else { [datetime]::MinValue }
Stop-ScheduledTask -TaskName $updaterTaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $updaterTaskName -Confirm:$false -ErrorAction SilentlyContinue
$principalSystem = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$wrapperScript`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $updaterTaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principalSystem | Out-Null

Write-Host '[55%] IMMEDIATE SYSTEM SELF-TEST' -ForegroundColor Cyan
Start-ScheduledTask -TaskName $updaterTaskName
$deadline = (Get-Date).AddMinutes(10)
do {
  Start-Sleep -Seconds 1
  $task = Get-ScheduledTask -TaskName $updaterTaskName -ErrorAction Stop
  $info = Get-ScheduledTaskInfo -TaskName $updaterTaskName -ErrorAction Stop
  if($task.State -ne 'Running' -and $info.LastRunTime -gt $previousLastRun){ break }
} while((Get-Date) -lt $deadline)
$task = Get-ScheduledTask -TaskName $updaterTaskName -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName $updaterTaskName -ErrorAction Stop
if($task.State -eq 'Running' -or $info.LastRunTime -le $previousLastRun){ Fail 'UPDATER_RUNTIME_TIMEOUT' 'SYSTEM updater did not complete within 10 minutes.' }
if($info.LastTaskResult -ne 0){
  $detail = ''
  if(Test-Path $statePath){ try { $s=Get-Content -Raw $statePath|ConvertFrom-Json; $detail=" lastResult=$($s.lastResult) error=$($s.errorMessage)" } catch {} }
  Fail 'UPDATER_RUNTIME_FAILED' "LastTaskResult=$($info.LastTaskResult)$detail"
}

Write-Host '[85%] VERIFY PHYSICAL COMMAND CENTER' -ForegroundColor Cyan
$commandTask = Get-ScheduledTask -TaskName $commandTaskName -ErrorAction Stop
if($commandTask.State -ne 'Running'){ Fail 'COMMAND_CENTER_NOT_RUNNING' $commandTask.State.ToString() }
$root = Invoke-WebRequest -UseBasicParsing -Uri "http://$CommandHost`:$Port/" -TimeoutSec 10
if($root.StatusCode -ne 200){ Fail 'WEB_NOT_200' "HTTP $($root.StatusCode)" }
if($root.Content -notlike '*OWNER COCKPIT V3*VISUAL REBUILD*'){ Fail 'V3_MARKER_MISSING' 'Owner Cockpit V3 marker missing.' }
$state = if(Test-Path $statePath){ Get-Content -Raw $statePath | ConvertFrom-Json } else { $null }

Write-Host '[100%] AUTO-UPDATER RUNTIME VERIFIED' -ForegroundColor Green
[ordered]@{
  status='PASS'
  updaterTask=$task.State.ToString()
  lastRunTime=$info.LastRunTime.ToString('o')
  lastTaskResult=$info.LastTaskResult
  lastResult=if($state){$state.lastResult}else{$null}
  installedSha=if($state){$state.installedSha}else{$null}
  commandCenter=$commandTask.State.ToString()
  web="http://$CommandHost`:$Port/"
  intervalMinutes=5
  systemToolchain=$true
  powershellPath=$powershellExe
} | ConvertTo-Json -Depth 5 -Compress
