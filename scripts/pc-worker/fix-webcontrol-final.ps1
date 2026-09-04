param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$TargetHead = '0b57f8570446a1c1751807e483d7f1e9eaf33f8b'
$TargetBranch = 'wo196/pc01-command-center-ui-v2'
$Repo = 'newsdayads/tigeriq-ai-lab'
$HostIp = '100.97.23.87'
$Port = 8787
$BaseUrl = "http://$HostIp`:$Port"
$ShortHead = $TargetHead.Substring(0,12)
$IsolatedWorkspace = "F:\TigerIQ\CommandCenter\source-final-$ShortHead"
$TempRoot = Join-Path $env:TEMP "TigerIQ-WebControl-Final-$ShortHead"
$LogPath = Join-Path $env:TEMP 'TigerIQ_WebControl_Final.log'

function Is-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Fail([string]$Code,[string]$Message) {
  throw "$Code`: $Message"
}

function Require-Command([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if(-not $cmd){ Fail 'DEPENDENCY_MISSING' $Name }
  return $cmd.Source
}

function Download-Exact([string]$RepoPath,[string]$Destination) {
  $url = "https://raw.githubusercontent.com/$Repo/$TargetHead/$RepoPath"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $Destination -TimeoutSec 90
  if(-not (Test-Path -LiteralPath $Destination)){ Fail 'DOWNLOAD_FAILED' $RepoPath }
  if((Get-Item -LiteralPath $Destination).Length -lt 100){ Fail 'DOWNLOAD_TOO_SMALL' $RepoPath }
}

function Run-PowerShellFile([string]$Path,[string[]]$Arguments = @()) {
  $argv = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$Path) + $Arguments
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argv -Wait -PassThru -NoNewWindow
  return [int]$p.ExitCode
}

function Read-WebStatus {
  return Invoke-RestMethod -UseBasicParsing -Uri "$BaseUrl/api/status" -TimeoutSec 20
}

if(-not (Is-Admin)) {
  $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argLine -Wait -PassThru
  exit $child.ExitCode
}

try {
  Start-Transcript -Path $LogPath -Force | Out-Null

  Write-Host '[05%] PRECHECK' -ForegroundColor Cyan
  Require-Command 'powershell.exe' | Out-Null
  Require-Command 'gh.exe' | Out-Null
  Require-Command 'git.exe' | Out-Null
  Require-Command 'node.exe' | Out-Null
  Require-Command 'npm.cmd' | Out-Null
  $tailscale = Require-Command 'tailscale.exe'

  & gh auth status | Out-Null
  if($LASTEXITCODE -ne 0){ Fail 'GH_AUTH_MISSING' 'GitHub CLI is not authenticated.' }

  $liveIp = @(& $tailscale ip -4 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if($liveIp.Count -ne 1 -or $liveIp[0] -ne $HostIp){
    Fail 'TAILSCALE_IP_MISMATCH' ("Expected {0}; found {1}" -f $HostIp,($liveIp -join ','))
  }

  New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
  $installerRaw = Join-Path $TempRoot 'install-command-center.raw.ps1'
  $installer = Join-Path $TempRoot 'install-command-center.isolated.ps1'
  $workerRepair = Join-Path $TempRoot 'repair-secure-worker-model-roles.ps1'

  Write-Host '[12%] DOWNLOAD PINNED REPAIR FILES' -ForegroundColor Cyan
  Download-Exact 'scripts/pc-worker/install-command-center.ps1' $installerRaw
  Download-Exact 'scripts/pc-worker/repair-secure-worker-model-roles.ps1' $workerRepair

  Write-Host '[18%] ISOLATE FROM DIRTY SHARED WORKSPACE' -ForegroundColor Cyan
  $text = [IO.File]::ReadAllText($installerRaw)
  $needle = '$workspace = ''F:\TigerIQ\Workspace\tigeriq-ai-lab'''
  $replacement = '$workspace = ''' + $IsolatedWorkspace + ''''
  if(-not $text.Contains($needle)){ Fail 'INSTALLER_LAYOUT_CHANGED' 'Pinned installer workspace declaration was not found.' }
  $text = $text.Replace($needle,$replacement)
  if($text.Contains($needle)){ Fail 'ISOLATION_FAILED' 'Installer still references the shared workspace.' }
  [IO.File]::WriteAllText($installer,$text,(New-Object Text.UTF8Encoding($false)))

  Write-Host '[25%] INSTALL COMMAND CENTER + LOCAL CI' -ForegroundColor Cyan
  $rc = Run-PowerShellFile $installer @('-Branch',$TargetBranch,'-Commit',$TargetHead,'-Port',[string]$Port,'-CommandHost',$HostIp)
  if($rc -ne 0){ Fail 'COMMAND_CENTER_INSTALL_FAILED' "Exit code $rc" }

  Write-Host '[55%] REPAIR 3 LOCAL AI ROLES' -ForegroundColor Cyan
  $rc = Run-PowerShellFile $workerRepair @('-Repo',$Repo)
  if($rc -ne 0){ Fail 'WORKER_MODEL_ROLE_REPAIR_FAILED' "Exit code $rc" }

  Write-Host '[72%] VERIFY LIVE GITHUB WORK SOURCE' -ForegroundColor Cyan
  $status = Read-WebStatus
  $rows = @($status.workOrders)
  if($rows.Count -lt 1){ Fail 'LIVE_WORK_SOURCE_EMPTY' 'Web Control still reports zero Work Orders.' }
  Write-Host ("[78%] LIVE WORK ORDERS: {0}" -f $rows.Count) -ForegroundColor Green

  Write-Host '[82%] AUTHENTICATED WEB DISPATCH CANARY' -ForegroundColor Cyan
  $secretPath = 'F:\TigerIQ\Secrets\command-center.secret'
  if(-not (Test-Path -LiteralPath $secretPath)){ Fail 'COMMAND_SECRET_MISSING' $secretPath }
  $secret = [IO.File]::ReadAllText($secretPath).Trim()
  if([string]::IsNullOrWhiteSpace($secret)){ Fail 'COMMAND_SECRET_EMPTY' 'Local command secret is empty.' }

  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $login = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/login" -Method Post -WebSession $session -Body @{ secret=$secret } -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 20
  Remove-Variable secret -ErrorAction SilentlyContinue
  if($login.StatusCode -lt 200 -or $login.StatusCode -ge 400){ Fail 'LOGIN_FAILED' ([string]$login.StatusCode) }

  $page = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/" -WebSession $session -TimeoutSec 20
  $csrfMatch = [regex]::Match($page.Content,'name="csrf"\s+value="([^"]+)"')
  if(-not $csrfMatch.Success){ Fail 'CSRF_NOT_FOUND' 'Login completed but CSRF token is missing.' }
  $csrf = $csrfMatch.Groups[1].Value

  $nonce = [Guid]::NewGuid().ToString('N').Substring(0,12)
  $instruction = "P0 E2E $nonce. Use only Secure Worker V3 typed tools. Run repo_status once, then finish with exact summary E2E_PASS_$nonce. Do not modify files, tasks, MAIN, Production, Web, Android, credentials, network, or system configuration."
  $idem = "web-final-$nonce"
  $submit = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/jobs" -Method Post -WebSession $session -Body @{ csrf=$csrf; instruction=$instruction; priority='Khẩn cấp'; idempotency=$idem } -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30
  if($submit.StatusCode -lt 200 -or $submit.StatusCode -ge 400){ Fail 'WEB_DISPATCH_FAILED' ([string]$submit.StatusCode) }

  Write-Host '[88%] WAIT FOR PC01 EXECUTOR + REVIEWER + JUDGE' -ForegroundColor Cyan
  $deadline = (Get-Date).AddMinutes(15)
  $last = $null
  $live = $null
  do {
    Start-Sleep -Seconds 10
    $live = Read-WebStatus
    $last = @($live.workOrders | Where-Object { [string]$_.goal -like "*$nonce*" } | Select-Object -First 1)
    if($last){
      $state = [string]$last.status
      Write-Host ("      E2E state: {0}" -f $state) -ForegroundColor DarkGray
      if($state -eq 'verified'){ break }
      if($state -in @('failed','blocked')){ Fail 'WEB_E2E_TERMINAL_FAILURE' "Canary ended as $state" }
    }
  } while((Get-Date) -lt $deadline)

  if(-not $last){ Fail 'WEB_E2E_NOT_VISIBLE' 'The Web-created Work Order did not appear in the Web projection.' }
  if([string]$last.status -ne 'verified'){ Fail 'WEB_E2E_TIMEOUT' "Canary remained $([string]$last.status)" }
  if([int]$last.evidenceCount -lt 1){ Fail 'WEB_E2E_NO_EVIDENCE' 'Verified canary has no evidence.' }

  Write-Host '[100%] TIGERIQ WEB CONTROL E2E PASS' -ForegroundColor Green
  [ordered]@{
    status='PASS'
    url=$BaseUrl
    targetHead=$TargetHead
    isolatedWorkspace=$IsolatedWorkspace
    liveWorkOrders=@($live.workOrders).Count
    e2eWorkOrder=[string]$last.id
    e2eStatus=[string]$last.status
    evidenceCount=[int]$last.evidenceCount
    path='WEB -> GitHub -> PC01 Secure Worker -> executor/reviewer/judge -> WEB'
    mainProductionChanged=$false
    log=$LogPath
  } | ConvertTo-Json -Depth 5 -Compress | Write-Host
  Stop-Transcript | Out-Null
  exit 0
}
catch {
  $msg = $_.Exception.Message
  Write-Host '[FAIL] TIGERIQ WEB CONTROL FINAL REPAIR FAILED' -ForegroundColor Red
  Write-Host $msg -ForegroundColor Red
  Write-Host ("LOG: {0}" -f $LogPath) -ForegroundColor Yellow
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}
