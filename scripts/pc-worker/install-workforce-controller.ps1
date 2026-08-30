param(
  [string]$RepoPath = 'F:\TigerIQ\Workspace\tigeriq-ai-lab',
  [string]$StatePath = 'F:\TigerIQ\State\workforce.jsonl',
  [string]$ControllerHost = '100.97.23.87',
  [int]$ControllerPort = 8790
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$TaskName = 'TigerIQ Workforce Controller'
$FirewallName = 'TigerIQ Workforce Controller (Tailscale)'
$RuntimeDir = 'F:\TigerIQ\Worker'
$SecretsDir = 'F:\TigerIQ\Secrets'
$SecretPath = Join-Path $SecretsDir 'workforce-admin.secret'
$RunnerPath = Join-Path $RuntimeDir 'run-workforce-controller.ps1'
$LogPath = Join-Path $RuntimeDir 'workforce-controller.log'

function Fail([string]$Code, [string]$Message) {
  Write-Error "$Code`: $Message"
  exit 1
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'ADMIN_REQUIRED' 'Run this installer once from an elevated PowerShell session.'
}

if ($ControllerHost -in @('0.0.0.0','::','127.0.0.1','localhost')) {
  Fail 'UNSAFE_BIND' 'ControllerHost must be the explicit private/Tailscale address of PC01.'
}
if ($ControllerPort -lt 1024 -or $ControllerPort -gt 65535) {
  Fail 'INVALID_PORT' 'ControllerPort must be between 1024 and 65535.'
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $node) { Fail 'NODE_MISSING' 'node.exe was not found.' }
if (-not $npm) { Fail 'NPM_MISSING' 'npm.cmd was not found.' }
if (-not $git) { Fail 'GIT_MISSING' 'git.exe was not found.' }

if (-not (Test-Path $RepoPath)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $RepoPath -Parent) | Out-Null
  & $git.Source clone 'https://github.com/newsdayads/tigeriq-ai-lab.git' $RepoPath
  if ($LASTEXITCODE -ne 0) { Fail 'REPO_CLONE_FAILED' 'Could not clone TigerIQ AI Lab.' }
}
if (-not (Test-Path (Join-Path $RepoPath '.git'))) { Fail 'INVALID_REPO' 'RepoPath is not a Git repository.' }

$dirty = & $git.Source -C $RepoPath status --porcelain
if ($LASTEXITCODE -ne 0) { Fail 'GIT_STATUS_FAILED' 'Could not inspect repository state.' }
if ($dirty) { Fail 'REPO_DIRTY' 'Existing TigerIQ workspace has local changes; installer will not overwrite them.' }

& $git.Source -C $RepoPath fetch origin main --prune
if ($LASTEXITCODE -ne 0) { Fail 'GIT_FETCH_FAILED' 'Could not fetch origin/main.' }
$branch = (& $git.Source -C $RepoPath branch --show-current).Trim()
if ($branch -ne 'main') {
  & $git.Source -C $RepoPath checkout main
  if ($LASTEXITCODE -ne 0) { Fail 'MAIN_CHECKOUT_FAILED' 'Could not switch the clean workspace to main.' }
}
& $git.Source -C $RepoPath pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { Fail 'MAIN_UPDATE_FAILED' 'main could not be fast-forwarded safely.' }

$ipPresent = Get-NetIPAddress -IPAddress $ControllerHost -ErrorAction SilentlyContinue
if (-not $ipPresent) {
  Fail 'TAILSCALE_IP_NOT_PRESENT' "PC01 does not currently own $ControllerHost. Tailscale/private network must be online before installation."
}

$conflict = Get-NetTCPConnection -LocalAddress $ControllerHost -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue
if ($conflict) { Fail 'PORT_IN_USE' "$ControllerHost`:$ControllerPort is already listening." }

Push-Location $RepoPath
try {
  & $npm.Source ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'NPM_CI_FAILED' 'npm ci failed.' }
  & $npm.Source run build
  if ($LASTEXITCODE -ne 0) { Fail 'BUILD_FAILED' 'TigerIQ build failed.' }
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $RuntimeDir, $SecretsDir, (Split-Path $StatePath -Parent) | Out-Null

if (-not (Test-Path $SecretPath)) {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  [IO.File]::WriteAllText($SecretPath, $secret, (New-Object Text.UTF8Encoding($false)))
}

$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
Set-Acl -Path $SecretPath -AclObject $acl

$nodePath = $node.Source.Replace("'", "''")
$repoEscaped = $RepoPath.Replace("'", "''")
$stateEscaped = $StatePath.Replace("'", "''")
$hostEscaped = $ControllerHost.Replace("'", "''")
$secretEscaped = $SecretPath.Replace("'", "''")
$logEscaped = $LogPath.Replace("'", "''")
$runner = @"
`$ErrorActionPreference = 'Stop'
Set-Location '$repoEscaped'
`$env:TIGERIQ_WORKFORCE_JOURNAL = '$stateEscaped'
`$env:TIGERIQ_WORKFORCE_HOST = '$hostEscaped'
`$env:TIGERIQ_WORKFORCE_PORT = '$ControllerPort'
`$env:TIGERIQ_WORKFORCE_ADMIN_SECRET = [IO.File]::ReadAllText('$secretEscaped').Trim()
& '$nodePath' 'dist/apps/workforce-controller/src/standalone.js' *>> '$logEscaped'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($RunnerPath, $runner, (New-Object Text.UTF8Encoding($false)))

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }

$powershell = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$RunnerPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
$principalTask = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principalTask | Out-Null

$existingFirewall = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
if ($existingFirewall) { Remove-NetFirewallRule -DisplayName $FirewallName }
New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $ControllerHost -LocalPort $ControllerPort -RemoteAddress '100.64.0.0/10' -Profile Any | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$httpOk = $false
try {
  $status = Invoke-RestMethod -Uri "http://$ControllerHost`:$ControllerPort/api/workforce/status" -TimeoutSec 5
  $httpOk = [bool]$status.ok
} catch {
  $httpOk = $false
}

$result = [ordered]@{
  status = if ($httpOk) { 'READY' } else { 'STARTED_NOT_YET_HEALTHY' }
  task = $TaskName
  bind = "$ControllerHost`:$ControllerPort"
  journal = $StatePath
  secret = 'STORED_LOCALLY_REDACTED'
  http = $httpOk
}
$result | ConvertTo-Json -Compress
if (-not $httpOk) { exit 2 }
