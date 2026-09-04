param(
  [Parameter(Mandatory=$true)][string]$Commit,
  [string]$Branch = 'wo196/pc01-command-center-ui-v2',
  [int]$Port = 8787,
  [string]$CommandHost = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'newsdayads/tigeriq-ai-lab'
$runtimeDir = 'F:\TigerIQ\CommandCenter'
$releaseRoot = Join-Path $runtimeDir 'releases'
$secretDir = 'F:\TigerIQ\Secrets'
$githubTokenPath = Join-Path $secretDir 'github-command-center.token'
$updaterScript = Join-Path $runtimeDir 'auto-update-command-center.ps1'
$statePath = Join-Path $runtimeDir 'auto-update-state.json'
$updaterTaskName = 'TigerIQ Command Center Updater'
$commandTaskName = 'TigerIQ Command Center'

function Fail([string]$Code,[string]$Message){ Write-Error "$Code`: $Message"; exit 1 }
function Test-TailscaleIPv4([string]$Address){
  if($Address -notmatch '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$'){ return $false }
  $p = $Address.Split('.') | ForEach-Object { [int]$_ }
  return $p[1] -ge 64 -and $p[1] -le 127 -and (@($p | Where-Object { $_ -lt 0 -or $_ -gt 255 }).Count -eq 0)
}
function Get-TailscaleCli {
  $candidate = 'C:\Program Files\Tailscale\tailscale.exe'
  if(Test-Path $candidate){ return $candidate }
  $cmd = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if($cmd){ return $cmd.Source }
  return $null
}
function Resolve-Host([string]$Requested){
  if($Requested -eq '127.0.0.1'){ return $Requested }
  $ts = Get-TailscaleCli
  if(-not $ts){ Fail 'TAILSCALE_MISSING' 'Tailscale CLI missing.' }
  $ips = @(& $ts ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { Test-TailscaleIPv4 $_ })
  if($LASTEXITCODE -ne 0 -or $ips.Count -ne 1){ Fail 'TAILSCALE_IP_UNAVAILABLE' "Expected one live Tailscale IPv4; found $($ips.Count)." }
  if($Requested -and $Requested -ne $ips[0]){ Fail 'TAILSCALE_IP_MISMATCH' "Requested $Requested but live IP is $($ips[0])." }
  return $ips[0]
}
function Write-State([hashtable]$Data){
  $current = @{}
  if(Test-Path $statePath){
    try {
      $obj = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
      if($null -ne $obj){ foreach($p in $obj.PSObject.Properties){ $current[$p.Name] = $p.Value } }
    } catch {}
  }
  foreach($key in $Data.Keys){ $current[$key] = $Data[$key] }
  $current['updatedAt'] = (Get-Date).ToUniversalTime().ToString('o')
  [IO.File]::WriteAllText($statePath,($current | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
}

Write-Host '[5%] REPAIR PRECHECK' -ForegroundColor Cyan
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){ Fail 'ADMIN_REQUIRED' 'Administrator permission required for Scheduled Task repair.' }
if($Commit -notmatch '^[0-9a-fA-F]{40}$'){ Fail 'INVALID_COMMIT' 'Commit must be an exact 40-character Git SHA.' }
if($Port -lt 1024 -or $Port -gt 65535){ Fail 'INVALID_PORT' 'Port out of range.' }
foreach($cmd in @('git.exe','gh.exe','node.exe','npm.cmd','powershell.exe')){ if(-not (Get-Command $cmd -ErrorAction SilentlyContinue)){ Fail 'DEPENDENCY_MISSING' "$cmd missing" } }
$hostIp = Resolve-Host $CommandHost
New-Item -ItemType Directory -Force -Path $runtimeDir,$releaseRoot,$secretDir | Out-Null

Write-Host '[12%] VERIFY REMOTE HEAD + CI' -ForegroundColor Cyan
$remoteHead = (& gh api "repos/$repo/commits/$([uri]::EscapeDataString($Branch))" --jq .sha 2>$null | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $remoteHead -ne $Commit){ Fail 'REMOTE_HEAD_MISMATCH' "Expected branch HEAD $Commit but got $remoteHead" }
$runsRaw = (& gh api "repos/$repo/actions/runs?head_sha=$Commit&status=completed&per_page=30" 2>$null | Out-String)
if($LASTEXITCODE -ne 0 -or -not $runsRaw){ Fail 'CI_STATUS_UNAVAILABLE' 'Could not read GitHub Actions status.' }
$runs = $runsRaw | ConvertFrom-Json
$ciPass = @($runs.workflow_runs | Where-Object { $_.name -eq 'CI' -and $_.conclusion -eq 'success' }) | Select-Object -First 1
if(-not $ciPass){ Fail 'CI_NOT_PASS' 'Exact commit does not have a successful CI run.' }

Write-Host '[20%] ISOLATED V3 RELEASE' -ForegroundColor Cyan
$short = $Commit.Substring(0,12)
$releaseDir = Join-Path $releaseRoot "repair-$short-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
if(Test-Path $releaseDir){ Fail 'RELEASE_PATH_EXISTS' $releaseDir }
$payload = (& gh api "repos/$repo/contents/scripts/pc-worker/install-command-center.ps1`?ref=$Commit" --jq .content 2>$null | Out-String) -replace '\s',''
if($LASTEXITCODE -ne 0 -or -not $payload){ Fail 'INSTALLER_FETCH_FAILED' 'Could not fetch exact installer.' }
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
$needle = "`$workspace = 'F:\TigerIQ\Workspace\tigeriq-ai-lab'"
$replacement = "`$workspace = '$releaseDir'"
if(-not $text.Contains($needle)){ Fail 'INSTALLER_LAYOUT_CHANGED' 'Workspace patch anchor missing.' }
$text = $text.Replace($needle,$replacement)
$inner = Join-Path $env:TEMP "tigeriq-v3-repair-$short.ps1"
[IO.File]::WriteAllText($inner,$text,(New-Object Text.UTF8Encoding($false)))
git config --global --add safe.directory ($releaseDir -replace '\\','/')
if($LASTEXITCODE -ne 0){ Fail 'SAFE_DIRECTORY_FAILED' 'Could not mark isolated release safe for current admin.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $inner -Branch $Branch -Commit $Commit -Port $Port -CommandHost $hostIp
if($LASTEXITCODE -ne 0){ Fail 'V3_INSTALL_FAILED' "Installer exit code $LASTEXITCODE" }

Write-Host '[72%] REPAIR AUTO-UPDATER TASK' -ForegroundColor Cyan
if(-not (Test-Path $updaterScript)){ Fail 'UPDATER_SCRIPT_MISSING' $updaterScript }
if(-not (Test-Path $githubTokenPath)){ Fail 'GITHUB_TOKEN_FILE_MISSING' $githubTokenPath }
Write-State @{ installedSha=$Commit; lastSeenSha=$Commit; branch=$Branch; lastResult='REPAIR_SEEDED'; releaseDir=$releaseDir; ciRunId=$ciPass.id }
Stop-ScheduledTask -TaskName $updaterTaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $updaterTaskName -Confirm:$false -ErrorAction SilentlyContinue
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$updaterArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$updaterScript`" -Branch `"$Branch`" -Port $Port -CommandHost `"$hostIp`""
$updaterAction = New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument $updaterArgs
$updaterTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$updaterSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $updaterTaskName -Action $updaterAction -Trigger $updaterTrigger -Settings $updaterSettings -Principal $taskPrincipal | Out-Null

Write-Host '[82%] UPDATER SYSTEM SELF-TEST' -ForegroundColor Cyan
$before = Get-Date
Start-ScheduledTask -TaskName $updaterTaskName
$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Milliseconds 500
  $scheduled = Get-ScheduledTask -TaskName $updaterTaskName -ErrorAction Stop
  $info = Get-ScheduledTaskInfo -TaskName $updaterTaskName -ErrorAction Stop
  if($scheduled.State -ne 'Running' -and $info.LastRunTime -ge $before){ break }
} while((Get-Date) -lt $deadline)
$scheduled = Get-ScheduledTask -TaskName $updaterTaskName -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName $updaterTaskName -ErrorAction Stop
if($scheduled.State -eq 'Running' -or $info.LastRunTime -lt $before){ Fail 'UPDATER_SELFTEST_TIMEOUT' 'Updater did not complete its immediate SYSTEM self-test.' }
if($info.LastTaskResult -ne 0){ Fail 'UPDATER_SELFTEST_FAILED' "Updater LastTaskResult=$($info.LastTaskResult)" }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
if([string]$state.lastSeenSha -ne $Commit){ Fail 'UPDATER_STATE_SHA_MISMATCH' "Expected $Commit but state has $($state.lastSeenSha)" }
if([string]$state.lastResult -ne 'NO_CHANGE'){ Fail 'UPDATER_STATE_NOT_HEALTHY' "Expected NO_CHANGE but got $($state.lastResult)" }

Write-Host '[92%] VISUAL + RUNTIME VERIFY' -ForegroundColor Cyan
$root = Invoke-WebRequest -UseBasicParsing -Uri "http://$hostIp`:$Port/" -TimeoutSec 10
if($root.StatusCode -ne 200){ Fail 'WEB_NOT_200' "HTTP $($root.StatusCode)" }
if($root.Content -notlike '*OWNER COCKPIT V3*VISUAL REBUILD*'){ Fail 'V3_MARKER_MISSING' 'Physical WebControl does not contain V3 visual marker.' }
$commandTask = Get-ScheduledTask -TaskName $commandTaskName -ErrorAction Stop
if($commandTask.State -ne 'Running'){ Fail 'COMMAND_CENTER_NOT_RUNNING' "Command Center task state=$($commandTask.State)" }

$result = [ordered]@{
  status='PASS'
  web="http://$hostIp`:$Port/"
  marker='OWNER_COCKPIT_V3_VISUAL_REBUILD'
  installedSha=$Commit
  ciRunId=$ciPass.id
  commandCenter=$commandTask.State.ToString()
  updater=[ordered]@{
    state=$scheduled.State.ToString()
    lastRunTime=$info.LastRunTime.ToString('o')
    lastTaskResult=$info.LastTaskResult
    selfTest='PASS'
    intervalMinutes=5
    exactShaCiGate=$true
  }
  releaseDir=$releaseDir
}
Write-Host '[100%] TIGERIQ V3 + AUTO-UPDATER VERIFIED' -ForegroundColor Green
$result | ConvertTo-Json -Depth 6 -Compress
