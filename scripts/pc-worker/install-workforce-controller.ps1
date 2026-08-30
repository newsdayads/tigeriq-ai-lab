param(
  [string]$RepoPath = 'F:\TigerIQ\Workspace\tigeriq-ai-lab',
  [string]$StatePath = 'F:\TigerIQ\State\workforce.jsonl',
  [string]$ControllerHost = '',
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

function Test-TailscaleIPv4([string]$Address) {
  if ($Address -notmatch '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') { return $false }
  $parts = $Address.Split('.') | ForEach-Object { [int]$_ }
  return $parts[1] -ge 64 -and $parts[1] -le 127 -and ($parts | Where-Object { $_ -lt 0 -or $_ -gt 255 }).Count -eq 0
}

function Get-TailscaleCli {
  $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidate = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path $candidate) { return $candidate }
  return $null
}

function Resolve-ControllerHost([string]$Requested) {
  $tailscale = Get-TailscaleCli
  if (-not $tailscale) { Fail 'TAILSCALE_MISSING' 'tailscale.exe was not found.' }

  $live = @(& $tailscale ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($LASTEXITCODE -ne 0) { Fail 'TAILSCALE_OFFLINE' 'Could not read the live Tailscale IPv4 address.' }
  $live = @($live | Where-Object { Test-TailscaleIPv4 $_ } | Select-Object -Unique)
  if ($live.Count -ne 1) { Fail 'TAILSCALE_IP_AMBIGUOUS' "Expected exactly one live Tailscale IPv4; found $($live.Count)." }

  $selected = if ($Requested.Trim()) { $Requested.Trim() } else { $live[0] }
  if (-not (Test-TailscaleIPv4 $selected)) { Fail 'UNSAFE_BIND' 'ControllerHost must be a Tailscale IPv4 in 100.64.0.0/10.' }
  if ($selected -ne $live[0]) { Fail 'TAILSCALE_IP_MISMATCH' "Requested $selected but live Tailscale IPv4 is $($live[0])." }
  if (-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $selected -ErrorAction SilentlyContinue)) {
    Fail 'TAILSCALE_IP_NOT_PRESENT' "PC01 does not currently own $selected."
  }
  return $selected
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'ADMIN_REQUIRED' 'Run this installer once from an elevated PowerShell session.'
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

$ControllerHost = Resolve-ControllerHost $ControllerHost

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
`$env:TIGERIQ_WORKFORCE_ALLOW_TAILNET_SELF_PAIR = '1'
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
  tailnetSelfPair = $true
  journal = $StatePath
  secret = 'STORED_LOCALLY_REDACTED'
  http = $httpOk
}
$result | ConvertTo-Json -Compress
if (-not $httpOk) { exit 2 }
