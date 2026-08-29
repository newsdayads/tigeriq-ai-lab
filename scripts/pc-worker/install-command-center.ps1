param(
  [string]$Branch = 'wo010/command-center-web-control',
  [int]$Port = 8787
)
$ErrorActionPreference = 'Stop'

$repo = 'newsdayads/tigeriq-ai-lab'
$workspace = 'F:\TigerIQ\Workspace\tigeriq-ai-lab'
$runtimeDir = 'F:\TigerIQ\CommandCenter'
$secretDir = 'F:\TigerIQ\Secrets'
$secretPath = Join-Path $secretDir 'command-center.secret'
$startScript = Join-Path $runtimeDir 'start-command-center.ps1'
$stdout = Join-Path $runtimeDir 'command-center.log'
$stderr = Join-Path $runtimeDir 'command-center.err.log'
$taskName = 'TigerIQ Command Center'

Write-Host '[10%] PRECHECK' -ForegroundColor Cyan
foreach($cmd in @('git','gh','node','npm','powershell')) {
  if(-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd missing" }
}
gh auth status | Out-Null
if($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be 1..65535' }

Write-Host '[20%] WORKSPACE' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Split-Path $workspace -Parent),$runtimeDir,$secretDir | Out-Null
if(-not (Test-Path (Join-Path $workspace '.git'))) {
  git clone "https://github.com/$repo.git" $workspace
  if($LASTEXITCODE -ne 0) { throw 'git clone failed' }
}
Push-Location $workspace
try {
  git fetch --all --prune
  if($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
  git checkout -B $Branch "origin/$Branch"
  if($LASTEXITCODE -ne 0) { throw 'checkout failed' }
  $dirty = git status --porcelain
  if($dirty) { throw "Workspace is dirty; refusing deployment: $dirty" }

  Write-Host '[35%] INSTALL + BUILD' -ForegroundColor Cyan
  cmd /c npm ci
  if($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  cmd /c npm run ci
  if($LASTEXITCODE -ne 0) { throw 'npm run ci failed' }
} finally {
  Pop-Location
}

Write-Host '[55%] LOCAL SECRET' -ForegroundColor Cyan
if(-not (Test-Path $secretPath)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  [Convert]::ToBase64String($bytes) | Set-Content -Path $secretPath -NoNewline -Encoding ascii
}
try {
  icacls $secretPath /inheritance:r /grant:r "$env:USERNAME:(R,W)" | Out-Null
} catch {
  Write-Host 'Warning: could not tighten secret ACL automatically' -ForegroundColor Yellow
}

Write-Host '[65%] PRIVATE BIND' -ForegroundColor Cyan
$hostIp = '127.0.0.1'
$tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
if($tailscale) {
  $candidate = (& $tailscale.Source ip -4 2>$null | Select-Object -First 1).Trim()
  if($candidate -match '^100\.') { $hostIp = $candidate }
}

$launcher = @"
`$ErrorActionPreference = 'Stop'
`$env:TIGERIQ_COMMAND_SECRET = (Get-Content -Raw '$secretPath').Trim()
`$env:TIGERIQ_COMMAND_HOST = '$hostIp'
`$env:TIGERIQ_COMMAND_PORT = '$Port'
`$env:TIGERIQ_JOURNAL = 'F:\TigerIQ\State\control-plane.jsonl'
Set-Location '$workspace'
cmd /c npm run command-center 1>> '$stdout' 2>> '$stderr'
exit `$LASTEXITCODE
"@
Set-Content -Path $startScript -Value $launcher -Encoding utf8

Write-Host '[75%] SCHEDULED TASK' -ForegroundColor Cyan
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep 5

Write-Host '[90%] HEALTH CHECK' -ForegroundColor Cyan
$healthUrl = "http://$hostIp`:$Port/api/status"
try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 8
} catch {
  $err = if(Test-Path $stderr) { Get-Content $stderr -Tail 40 | Out-String } else { '' }
  throw "Command Center health check failed at $healthUrl`n$err"
}

Write-Host '[100%] TIGERIQ COMMAND CENTER READY' -ForegroundColor Green
Write-Host "Private URL: http://$hostIp`:$Port"
Write-Host "Secret file: $secretPath"
Write-Host "Task: $taskName"
Write-Host 'Use the same Tailscale network on iPhone/Android to open the Private URL.'
