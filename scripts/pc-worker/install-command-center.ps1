param(
  [string]$Branch = 'main',
  [int]$Port = 8787,
  [string]$CommandHost = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'newsdayads/tigeriq-ai-lab'
$workspace = 'F:\TigerIQ\Workspace\tigeriq-ai-lab'
$runtimeDir = 'F:\TigerIQ\CommandCenter'
$secretDir = 'F:\TigerIQ\Secrets'
$secretPath = Join-Path $secretDir 'command-center.secret'
$githubTokenPath = Join-Path $secretDir 'github-command-center.token'
$startScript = Join-Path $runtimeDir 'start-command-center.ps1'
$stdout = Join-Path $runtimeDir 'command-center.log'
$stderr = Join-Path $runtimeDir 'command-center.err.log'
$taskName = 'TigerIQ Command Center'
$firewallName = 'TigerIQ Command Center (Tailscale)'

function Fail([string]$Code, [string]$Message) {
  Write-Error "$Code`: $Message"
  exit 1
}

function Test-TailscaleIPv4([string]$Address) {
  if ($Address -notmatch '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') { return $false }
  $parts = $Address.Split('.') | ForEach-Object { [int]$_ }
  $invalidParts = @($parts | Where-Object { $_ -lt 0 -or $_ -gt 255 })
  return $parts[1] -ge 64 -and $parts[1] -le 127 -and $invalidParts.Count -eq 0
}

function Get-TailscaleCli {
  $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $command = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidate = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path $candidate) { return $candidate }
  return $null
}

function Resolve-PrivateHost([string]$Requested) {
  if ($Requested.Trim() -eq '127.0.0.1') { return '127.0.0.1' }
  $tailscale = Get-TailscaleCli
  if (-not $tailscale) { Fail 'TAILSCALE_MISSING' 'Tailscale is required for the PRIMARY private Command Center.' }
  $live = @(& $tailscale ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($LASTEXITCODE -ne 0) { Fail 'TAILSCALE_OFFLINE' 'Could not read the live Tailscale IPv4 address.' }
  $live = @($live | Where-Object { Test-TailscaleIPv4 $_ } | Select-Object -Unique)
  if ($live.Count -ne 1) { Fail 'TAILSCALE_IP_AMBIGUOUS' "Expected exactly one Tailscale IPv4; found $($live.Count)." }
  $selected = if ($Requested.Trim()) { $Requested.Trim() } else { $live[0] }
  if (-not (Test-TailscaleIPv4 $selected)) { Fail 'UNSAFE_BIND' 'CommandHost must be 127.0.0.1 or a Tailscale IPv4 in 100.64.0.0/10.' }
  if ($selected -ne $live[0]) { Fail 'TAILSCALE_IP_MISMATCH' "Requested $selected but live Tailscale IPv4 is $($live[0])." }
  if (-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $selected -ErrorAction SilentlyContinue)) { Fail 'TAILSCALE_IP_NOT_PRESENT' "PC01 does not own $selected." }
  return $selected
}

function Protect-SecretFile([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -Path $Path -AclObject $acl
}

Write-Host '[10%] PRECHECK' -ForegroundColor Cyan
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'ADMIN_REQUIRED' 'Installer requires one elevated run to register the startup task and tailnet-only firewall rule.' }
foreach($cmd in @('git.exe','gh.exe','node.exe','npm.cmd','powershell.exe')) {
  if(-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail 'DEPENDENCY_MISSING' "$cmd missing" }
}
gh auth status | Out-Null
if($LASTEXITCODE -ne 0){ Fail 'GH_AUTH_MISSING' 'GitHub CLI is not authenticated.' }
if($Port -lt 1024 -or $Port -gt 65535) { Fail 'INVALID_PORT' 'Port must be between 1024 and 65535.' }
$hostIp = Resolve-PrivateHost $CommandHost

Write-Host '[20%] WORKSPACE' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Split-Path $workspace -Parent),$runtimeDir,$secretDir | Out-Null
if(-not (Test-Path (Join-Path $workspace '.git'))) {
  git clone "https://github.com/$repo.git" $workspace
  if($LASTEXITCODE -ne 0) { Fail 'CLONE_FAILED' 'git clone failed' }
}
$dirty = git -C $workspace status --porcelain
if($LASTEXITCODE -ne 0){ Fail 'GIT_STATUS_FAILED' 'Could not inspect workspace.' }
if($dirty){ Fail 'REPO_DIRTY' 'Workspace has local changes; refusing to overwrite.' }
git -C $workspace fetch origin $Branch --prune
if($LASTEXITCODE -ne 0) { Fail 'GIT_FETCH_FAILED' "Could not fetch origin/$Branch" }
git -C $workspace checkout -B $Branch "origin/$Branch"
if($LASTEXITCODE -ne 0) { Fail 'CHECKOUT_FAILED' "Could not checkout origin/$Branch" }
$dirty = git -C $workspace status --porcelain
if($dirty) { Fail 'REPO_DIRTY_AFTER_CHECKOUT' 'Workspace is dirty after checkout.' }

Write-Host '[35%] INSTALL + CI + BUILD' -ForegroundColor Cyan
Push-Location $workspace
try {
  cmd /c npm ci --no-audit --no-fund
  if($LASTEXITCODE -ne 0) { Fail 'NPM_CI_FAILED' 'npm ci failed' }
  cmd /c npm run ci
  if($LASTEXITCODE -ne 0) { Fail 'CI_FAILED' 'npm run ci failed' }
} finally {
  Pop-Location
}

Write-Host '[55%] LOCAL SECRETS' -ForegroundColor Cyan
if(-not (Test-Path $secretPath)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [Convert]::ToBase64String($bytes) | Set-Content -Path $secretPath -NoNewline -Encoding ascii
}
Protect-SecretFile $secretPath
$ghToken = (& gh auth token 2>$null | Out-String).Trim()
if(-not $ghToken){ Fail 'GH_TOKEN_UNAVAILABLE' 'Existing GitHub auth could not be materialized for the SYSTEM startup task.' }
[IO.File]::WriteAllText($githubTokenPath, $ghToken, (New-Object Text.UTF8Encoding($false)))
Protect-SecretFile $githubTokenPath
Remove-Variable ghToken -ErrorAction SilentlyContinue

Write-Host '[65%] PRIVATE BIND + FIREWALL' -ForegroundColor Cyan
$existingFirewall = Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
if($existingFirewall){ Remove-NetFirewallRule -DisplayName $firewallName }
if($hostIp -ne '127.0.0.1') {
  New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $hostIp -LocalPort $Port -RemoteAddress '100.64.0.0/10' -Profile Any | Out-Null
}

$nodePath = (Get-Command node.exe).Source.Replace("'", "''")
$repoEscaped = $workspace.Replace("'", "''")
$secretEscaped = $secretPath.Replace("'", "''")
$githubTokenEscaped = $githubTokenPath.Replace("'", "''")
$stdoutEscaped = $stdout.Replace("'", "''")
$stderrEscaped = $stderr.Replace("'", "''")
$launcher = @"
`$ErrorActionPreference = 'Stop'
`$env:TIGERIQ_COMMAND_SECRET = [IO.File]::ReadAllText('$secretEscaped').Trim()
`$env:GH_TOKEN = [IO.File]::ReadAllText('$githubTokenEscaped').Trim()
`$env:TIGERIQ_COMMAND_HOST = '$hostIp'
`$env:TIGERIQ_COMMAND_PORT = '$Port'
`$env:TIGERIQ_JOURNAL = 'F:\TigerIQ\State\control-plane.jsonl'
`$env:TIGERIQ_REPO_ROOT = '$repoEscaped'
`$env:TIGERIQ_REPO = '$repo'
Set-Location '$repoEscaped'
& '$nodePath' 'dist/apps/dashboard/src/standalone.js' 1>> '$stdoutEscaped' 2>> '$stderrEscaped'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($startScript, $launcher, (New-Object Text.UTF8Encoding($false)))

Write-Host '[75%] WINDOWS AUTO-START' -ForegroundColor Cyan
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep 5

Write-Host '[90%] HEALTH + EXPOSURE CHECK' -ForegroundColor Cyan
$healthUrl = "http://$hostIp`:$Port/api/status"
try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 8
} catch {
  Fail 'HEALTH_FAILED' "Command Center health check failed at $healthUrl"
}
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if(-not $listener){ Fail 'LISTENER_MISSING' "No listener found on port $Port" }
if($listener.LocalAddress -eq '0.0.0.0' -or $listener.LocalAddress -eq '::'){ Fail 'PUBLIC_EXPOSURE' "Wildcard listener detected on port $Port" }
if($listener.LocalAddress -ne $hostIp){ Fail 'BIND_MISMATCH' "Expected $hostIp but listener is $($listener.LocalAddress)" }
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop

$result = [ordered]@{
  status = 'READY'
  privateUrl = "http://$hostIp`:$Port"
  bind = "$hostIp`:$Port"
  wildcardExposure = $false
  task = [ordered]@{ name=$taskName; state=$task.State.ToString(); trigger='AtStartup'; principal='SYSTEM' }
  branch = $Branch
  journal = 'F:\TigerIQ\State\control-plane.jsonl'
  commandAuth = 'STORED_LOCALLY_REDACTED'
  githubAuth = 'STORED_LOCALLY_REDACTED'
  health = $true
}
Write-Host '[100%] TIGERIQ COMMAND CENTER READY' -ForegroundColor Green
$result | ConvertTo-Json -Depth 5 -Compress
