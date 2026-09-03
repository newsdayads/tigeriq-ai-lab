param(
  [string]$Branch = 'wo196/pc01-command-center-ui-v2',
  [int]$Port = 8787,
  [Parameter(Mandatory=$true)][string]$CommandHost,
  [Parameter(Mandatory=$true)][string]$GhPath,
  [Parameter(Mandatory=$true)][string]$GitPath,
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$NpmPath,
  [Parameter(Mandatory=$true)][string]$RepairCommit
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'newsdayads/tigeriq-ai-lab'
$runtimeDir = 'F:\TigerIQ\CommandCenter'
$updaterScript = Join-Path $runtimeDir 'auto-update-command-center.ps1'
$wrapperScript = Join-Path $runtimeDir 'run-auto-update-command-center.ps1'
$statePath = Join-Path $runtimeDir 'auto-update-state.json'
$tokenPath = 'F:\TigerIQ\Secrets\github-command-center.token'
$updaterTaskName = 'TigerIQ Command Center Updater'
$commandTaskName = 'TigerIQ Command Center'

function Fail([string]$Code,[string]$Message){ Write-Error "$Code`: $Message"; exit 1 }
function Read-StateObject {
  if(-not (Test-Path -LiteralPath $statePath)){ return $null }
  try { return (Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json) } catch { return $null }
}

Write-Host '[10%] UPDATER RUNTIME PRECHECK' -ForegroundColor Cyan
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){ Fail 'ADMIN_REQUIRED' 'Administrator permission is required.' }
if($Port -lt 1024 -or $Port -gt 65535){ Fail 'INVALID_PORT' 'Port out of range.' }
if($CommandHost -notmatch '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$' -and $CommandHost -ne '127.0.0.1'){ Fail 'UNSAFE_COMMAND_HOST' $CommandHost }
if($RepairCommit -notmatch '^[0-9a-fA-F]{40}$'){ Fail 'INVALID_REPAIR_COMMIT' $RepairCommit }
foreach($p in @($GhPath,$GitPath,$NodePath,$NpmPath,$tokenPath)){ if(-not (Test-Path -LiteralPath $p)){ Fail 'REQUIRED_PATH_MISSING' $p } }
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$powershellDir = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0'
$powershellExe = Join-Path $powershellDir 'powershell.exe'
if(-not (Test-Path -LiteralPath $powershellExe)){ Fail 'POWERSHELL_NOT_FOUND' $powershellExe }

Write-Host '[20%] VERIFY PINNED CI + BRANCH HEAD' -ForegroundColor Cyan
$encodedBranch = [uri]::EscapeDataString($Branch)
$currentHead = (& $GhPath api "repos/$repo/commits/$encodedBranch" --jq .sha 2>$null | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $currentHead -notmatch '^[0-9a-f]{40}$'){ Fail 'REMOTE_HEAD_UNAVAILABLE' $Branch }
if($currentHead -ne $RepairCommit){ Fail 'BRANCH_HEAD_MOVED' "Expected $RepairCommit but branch head is $currentHead. Use a newly pinned repair package." }
$runsRaw = (& $GhPath api "repos/$repo/actions/runs?head_sha=$RepairCommit&status=completed&per_page=30" 2>$null | Out-String)
if($LASTEXITCODE -ne 0 -or -not $runsRaw){ Fail 'CI_STATUS_UNAVAILABLE' $RepairCommit }
$runs = $runsRaw | ConvertFrom-Json
$ciPass = @($runs.workflow_runs | Where-Object { $_.name -eq 'CI' -and $_.conclusion -eq 'success' }) | Select-Object -First 1
if(-not $ciPass){ Fail 'CI_NOT_PASS' $RepairCommit }

Write-Host '[30%] INSTALL PINNED UPDATER V2' -ForegroundColor Cyan
$updaterPayload = (& $GhPath api "repos/$repo/contents/scripts/pc-worker/auto-update-command-center.ps1?ref=$RepairCommit" --jq .content 2>$null | Out-String) -replace '\s',''
if($LASTEXITCODE -ne 0 -or -not $updaterPayload){ Fail 'UPDATER_FETCH_FAILED' $RepairCommit }
$updaterText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($updaterPayload))
if($updaterText -notlike '*TIGERIQ_AUTO_UPDATER_V2*'){ Fail 'UPDATER_VERSION_MISMATCH' 'Pinned updater is not V2.' }
$updaterTemp = "$updaterScript.new"
[IO.File]::WriteAllText($updaterTemp,$updaterText,(New-Object Text.UTF8Encoding($false)))
Move-Item -Force -LiteralPath $updaterTemp -Destination $updaterScript

Write-Host '[40%] BUILD SYSTEM TOOLCHAIN WRAPPER' -ForegroundColor Cyan
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

Write-Host '[50%] REGISTER SYSTEM UPDATER' -ForegroundColor Cyan
$previousUpdaterInfo = Get-ScheduledTaskInfo -TaskName $updaterTaskName -ErrorAction SilentlyContinue
$previousUpdaterLastRun = if($previousUpdaterInfo){ $previousUpdaterInfo.LastRunTime } else { [datetime]::MinValue }
$previousCommandInfo = Get-ScheduledTaskInfo -TaskName $commandTaskName -ErrorAction SilentlyContinue
$previousCommandLastRun = if($previousCommandInfo){ $previousCommandInfo.LastRunTime } else { [datetime]::MinValue }
$previousState = Read-StateObject
$previousInstalledSha = if($previousState){ [string]$previousState.installedSha } else { '' }

Stop-ScheduledTask -TaskName $updaterTaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $updaterTaskName -Confirm:$false -ErrorAction SilentlyContinue
$principalSystem = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$wrapperScript`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $updaterTaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principalSystem | Out-Null

Write-Host '[60%] IMMEDIATE SYSTEM SELF-TEST' -ForegroundColor Cyan
Start-ScheduledTask -TaskName $updaterTaskName
$deadline = (Get-Date).AddMinutes(15)
do {
  Start-Sleep -Seconds 1
  $task = Get-ScheduledTask -TaskName $updaterTaskName -ErrorAction Stop
  $info = Get-ScheduledTaskInfo -TaskName $updaterTaskName -ErrorAction Stop
  if($task.State -ne 'Running' -and $info.LastRunTime -gt $previousUpdaterLastRun){ break }
} while((Get-Date) -lt $deadline)
$task = Get-ScheduledTask -TaskName $updaterTaskName -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName $updaterTaskName -ErrorAction Stop
if($task.State -eq 'Running' -or $info.LastRunTime -le $previousUpdaterLastRun){ Fail 'UPDATER_RUNTIME_TIMEOUT' 'SYSTEM updater did not complete within 15 minutes.' }
$state = Read-StateObject
if($info.LastTaskResult -ne 0){
  $detail = if($state){ " lastResult=$($state.lastResult) error=$($state.errorMessage) stderr=$($state.installStderrTail) stdout=$($state.installStdoutTail)" } else { '' }
  Fail 'UPDATER_RUNTIME_FAILED' "LastTaskResult=$($info.LastTaskResult)$detail"
}
if(-not $state){ Fail 'UPDATER_STATE_MISSING' $statePath }
if([string]$state.installedSha -ne $RepairCommit){ Fail 'INSTALLED_SHA_MISMATCH' "Expected $RepairCommit got $($state.installedSha)" }
if([string]$state.updaterVersion -ne 'V2'){ Fail 'UPDATER_STATE_VERSION_MISMATCH' ([string]$state.updaterVersion) }
if([string]$state.lastResult -notin @('UPDATED','NO_CHANGE')){ Fail 'UPDATER_STATE_NOT_FINAL' ([string]$state.lastResult) }

Write-Host '[85%] VERIFY PHYSICAL COMMAND CENTER' -ForegroundColor Cyan
$commandTask = Get-ScheduledTask -TaskName $commandTaskName -ErrorAction Stop
$commandInfo = Get-ScheduledTaskInfo -TaskName $commandTaskName -ErrorAction Stop
if($commandTask.State -ne 'Running'){ Fail 'COMMAND_CENTER_NOT_RUNNING' $commandTask.State.ToString() }
if($previousInstalledSha -ne $RepairCommit -and $commandInfo.LastRunTime -le $previousCommandLastRun){ Fail 'COMMAND_CENTER_NOT_RESTARTED' "LastRunTime=$($commandInfo.LastRunTime.ToString('o'))" }
$root = Invoke-WebRequest -UseBasicParsing -Uri "http://$CommandHost`:$Port/" -TimeoutSec 10
if($root.StatusCode -ne 200){ Fail 'WEB_NOT_200' "HTTP $($root.StatusCode)" }
if($root.Content -notlike '*OWNER COCKPIT V3*VISUAL REBUILD*'){ Fail 'V3_MARKER_MISSING' 'Owner Cockpit V3 marker missing.' }

Write-Host '[100%] AUTO-UPDATER V2 VERIFIED' -ForegroundColor Green
[ordered]@{
  status='PASS'
  updaterVersion='V2'
  updaterTask=$task.State.ToString()
  updaterLastRun=$info.LastRunTime.ToString('o')
  updaterLastTaskResult=$info.LastTaskResult
  lastResult=$state.lastResult
  installedSha=$state.installedSha
  installMode=$state.installMode
  commandCenter=$commandTask.State.ToString()
  commandCenterLastRun=$commandInfo.LastRunTime.ToString('o')
  web="http://$CommandHost`:$Port/"
  intervalMinutes=5
  ciRunId=$ciPass.id
  systemToolchain=$true
  powershellPath=$powershellExe
} | ConvertTo-Json -Depth 5 -Compress
