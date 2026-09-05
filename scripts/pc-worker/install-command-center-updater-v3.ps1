# TIGERIQ_COMMAND_CENTER_UPDATER_V3_BOOTSTRAP
param(
  [string]$Repo = 'newsdayads/tigeriq-ai-lab',
  [string]$Branch = 'wo250/command-center-artifact-updater-v3',
  [string]$HostIp = '100.97.23.87',
  [int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$runtimeDir = 'F:\TigerIQ\CommandCenter'
$secretDir = 'F:\TigerIQ\Secrets'
$secretPath = Join-Path $secretDir 'command-center.secret'
$tokenPath = Join-Path $secretDir 'github-command-center.token'
$updaterPath = Join-Path $runtimeDir 'command-center-updater-v3.ps1'
$launcherPath = Join-Path $runtimeDir 'start-command-center-v3.ps1'
$currentPath = Join-Path $runtimeDir 'current-release.txt'
$statePath = Join-Path $runtimeDir 'updater-v3-state.json'
$commandTask = 'TigerIQ Command Center'
$updaterTask = 'TigerIQ Command Center Updater V3'

function Fail([string]$code,[string]$message){ throw "$code`: $message" }
function Resolve-Tool([string]$name,[string[]]$candidates=@()){
  $found = Get-Command $name -ErrorAction SilentlyContinue
  if($found){ return $found.Source }
  foreach($candidate in $candidates){ if(Test-Path -LiteralPath $candidate){ return $candidate } }
  Fail 'TOOL_MISSING' $name
}
function Protect-File([string]$path){
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -LiteralPath $path -AclObject $acl
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){ Fail 'ADMIN_REQUIRED' 'Run once as Administrator.' }
if($Port -lt 1024 -or $Port -gt 65535){ Fail 'INVALID_PORT' ([string]$Port) }
$gh = Resolve-Tool 'gh.exe' @('C:\Program Files\GitHub CLI\gh.exe')
$node = Resolve-Tool 'node.exe' @('C:\Program Files\nodejs\node.exe')
$powershell = Resolve-Tool 'powershell.exe' @('C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe')
New-Item -ItemType Directory -Force -Path $runtimeDir,$secretDir | Out-Null

& $gh auth status | Out-Null
if($LASTEXITCODE -ne 0){ Fail 'GH_AUTH_REQUIRED' 'GitHub CLI is not authenticated.' }
if(-not (Test-Path -LiteralPath $tokenPath)){
  $token = (& $gh auth token | Out-String).Trim()
  if(-not $token){ Fail 'GH_TOKEN_UNAVAILABLE' 'Could not materialize existing GitHub auth.' }
  [IO.File]::WriteAllText($tokenPath,$token,(New-Object Text.UTF8Encoding($false)))
  Remove-Variable token -ErrorAction SilentlyContinue
  Protect-File $tokenPath
}
if(-not (Test-Path -LiteralPath $secretPath)){
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [IO.File]::WriteAllText($secretPath,[Convert]::ToBase64String($bytes),(New-Object Text.UTF8Encoding($false)))
  Protect-File $secretPath
}

$env:GH_TOKEN = [IO.File]::ReadAllText($tokenPath).Trim()
$encoded = [uri]::EscapeDataString($Branch)
$head = (& $gh api "repos/$Repo/commits/$encoded" --jq .sha | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$'){ Fail 'BRANCH_HEAD_UNAVAILABLE' $Branch }
$runsRaw = (& $gh api "repos/$Repo/actions/runs?head_sha=$head&status=completed&per_page=30" | Out-String)
$runs = $runsRaw | ConvertFrom-Json
$ci = @($runs.workflow_runs | Where-Object { $_.name -eq 'CI' -and $_.conclusion -eq 'success' }) | Select-Object -First 1
if(-not $ci){ Fail 'WAIT_CI_PASS' $head }

$payload = (& $gh api "repos/$Repo/contents/scripts/pc-worker/command-center-updater-v3.ps1?ref=$head" --jq .content | Out-String) -replace '\s',''
if($LASTEXITCODE -ne 0 -or -not $payload){ Fail 'UPDATER_FETCH_FAILED' $head }
$updaterText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
if($updaterText -notmatch 'TIGERIQ_COMMAND_CENTER_UPDATER_V3'){ Fail 'UPDATER_MARKER_MISSING' $head }
[IO.File]::WriteAllText($updaterPath,$updaterText,(New-Object Text.UTF8Encoding($false)))
Remove-Variable updaterText -ErrorAction SilentlyContinue

$launcher = @"
`$ErrorActionPreference = 'Stop'
`$release = [IO.File]::ReadAllText('$currentPath').Trim()
if(-not `$release -or -not (Test-Path -LiteralPath `$release)){ throw 'CURRENT_RELEASE_MISSING' }
`$env:TIGERIQ_COMMAND_SECRET = [IO.File]::ReadAllText('$secretPath').Trim()
`$env:GH_TOKEN = [IO.File]::ReadAllText('$tokenPath').Trim()
`$env:TIGERIQ_COMMAND_HOST = '$HostIp'
`$env:TIGERIQ_COMMAND_PORT = '$Port'
`$env:TIGERIQ_JOURNAL = 'F:\TigerIQ\State\control-plane.jsonl'
`$env:TIGERIQ_REPO_ROOT = `$release
`$env:TIGERIQ_REPO = '$Repo'
Set-Location `$release
& '$node' (Join-Path `$release 'dist\apps\dashboard\src\standalone.js')
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($launcherPath,$launcher,(New-Object Text.UTF8Encoding($false)))

Stop-ScheduledTask -TaskName $commandTask -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $commandTask -Confirm:$false -ErrorAction SilentlyContinue
$principalTask = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$commandAction = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$launcherPath`""
$commandTrigger = New-ScheduledTaskTrigger -AtStartup
$commandSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $commandTask -Action $commandAction -Trigger $commandTrigger -Settings $commandSettings -Principal $principalTask | Out-Null

Stop-ScheduledTask -TaskName $updaterTask -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $updaterTask -Confirm:$false -ErrorAction SilentlyContinue
$updaterAction = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$updaterPath`" -Repo `"$Repo`" -Branch `"$Branch`" -HostIp `"$HostIp`" -Port $Port"
$updaterTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$updaterSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName $updaterTask -Action $updaterAction -Trigger $updaterTrigger -Settings $updaterSettings -Principal $principalTask | Out-Null

Start-ScheduledTask -TaskName $updaterTask
$deadline = (Get-Date).AddMinutes(8)
do {
  Start-Sleep -Seconds 5
  if(Test-Path -LiteralPath $statePath){
    try {
      $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
      if($state.result -eq 'UPDATED' -or $state.result -eq 'NO_CHANGE'){
        Write-Host '[100%] TIGERIQ COMMAND CENTER AUTO UPDATE V3 READY' -ForegroundColor Green
        [ordered]@{status='READY'; updater='artifact-pull-v3'; intervalMinutes=2; gitRuntime=$false; currentRelease=$state.installedSha; commandTask=$commandTask; updaterTask=$updaterTask} | ConvertTo-Json -Compress
        exit 0
      }
      if($state.result -eq 'FAILED'){ Fail 'UPDATER_FIRST_RUN_FAILED' ([string]$state.error) }
    } catch { if($_.Exception.Message -like 'UPDATER_FIRST_RUN_FAILED*'){ throw } }
  }
} while((Get-Date) -lt $deadline)
Fail 'UPDATER_FIRST_RUN_TIMEOUT' 'No successful first deployment within 8 minutes.'
