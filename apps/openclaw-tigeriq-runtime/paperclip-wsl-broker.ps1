$ErrorActionPreference = 'Stop'

$LabRoot = 'D:\TigerIQ-Paperclip-Lab'
$BrokerRoot = Join-Path $LabRoot 'broker'
$Requests = Join-Path $BrokerRoot 'requests'
$Responses = Join-Path $BrokerRoot 'responses'
$Heartbeat = Join-Path $BrokerRoot 'heartbeat.json'
$Wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$Distro = 'Ubuntu'
$BrokerVersion = '1.5-db-sidecar-diagnostic'
$Image = 'ghcr.io/paperclipai/paperclip:2026.916.1'
$Container = 'tigeriq-paperclip-lab'
$Compose = '/mnt/d/TigerIQ-Paperclip-Lab/config/docker-compose.lab.yml'

New-Item -ItemType Directory -Force -Path $Requests,$Responses | Out-Null
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\TigerIQPaperclipWslBrokerV1', [ref]$created)
if (-not $created) { exit 0 }

function Write-JsonAtomic([string]$Path, $Value) {
  $tmp = "$Path.tmp-$PID"
  $Value | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Write-BrokerHeartbeat {
  Write-JsonAtomic $Heartbeat ([pscustomobject]@{
    schema='TIGERIQ_PAPERCLIP_WSL_HEARTBEAT_V1'
    version=$BrokerVersion
    at=(Get-Date).ToUniversalTime().ToString('o')
    sessionId=(Get-Process -Id $PID).SessionId
    user=[Environment]::UserName
    pid=$PID
    distro=$Distro
  })
}

function Quote-FixedArg([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Get-OperationSpec([string]$Operation) {
  switch ($Operation) {
    'version' {
      return [pscustomobject]@{ TimeoutSec=20; Args=@('--distribution',$Distro,'--exec','docker','version','--format','{{.Server.Version}}') }
    }
    'pull_pinned_image' {
      return [pscustomobject]@{ TimeoutSec=1200; IdleTimeoutSec=300; Args=@('--distribution',$Distro,'--exec','docker','pull',$Image) }
    }
    'inspect_revision' {
      return [pscustomobject]@{ TimeoutSec=30; Args=@('--distribution',$Distro,'--exec','docker','image','inspect',$Image,'--format','{{ index .Config.Labels "org.opencontainers.image.revision" }}') }
    }
    'inspect_repo_digests' {
      return [pscustomobject]@{ TimeoutSec=30; Args=@('--distribution',$Distro,'--exec','docker','image','inspect',$Image,'--format','{{json .RepoDigests}}') }
    }
    'compose_up' {
      return [pscustomobject]@{ TimeoutSec=120; Args=@('--distribution',$Distro,'--exec','docker','compose','-f',$Compose,'up','-d') }
    }
    'compose_stop' {
      return [pscustomobject]@{ TimeoutSec=60; Args=@('--distribution',$Distro,'--exec','docker','compose','-f',$Compose,'stop') }
    }
    'compose_ps_all_db_json' {
      return [pscustomobject]@{ TimeoutSec=30; Args=@('--distribution',$Distro,'--exec','docker','compose','-f',$Compose,'ps','--all','--format','json','db') }
    }
    'compose_db_logs_tail' {
      return [pscustomobject]@{ TimeoutSec=30; Args=@('--distribution',$Distro,'--exec','docker','compose','-f',$Compose,'logs','--no-color','--tail','120','db') }
    }
    'stop_container' {
      return [pscustomobject]@{ TimeoutSec=60; Args=@('--distribution',$Distro,'--exec','docker','stop',$Container) }
    }
    'inspect_container' {
      return [pscustomobject]@{ TimeoutSec=30; Args=@('--distribution',$Distro,'--exec','docker','inspect',$Container,'--format','{{json .}}') }
    }
    'container_logs_tail' {
      return [pscustomobject]@{ TimeoutSec=20; Args=@('--distribution',$Distro,'--exec','docker','logs','--tail','160',$Container) }
    }
    default { throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_OPERATION_NOT_ALLOWED' }
  }
}

function Invoke-FixedWslDocker([string]$RequestId, [string]$Operation) {
  if (-not (Test-Path -LiteralPath $Wsl -PathType Leaf)) { throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_WSL_NOT_FOUND' }
  $spec = Get-OperationSpec $Operation
  $stdoutPath = Join-Path $BrokerRoot "stdout-$RequestId.txt"
  $stderrPath = Join-Path $BrokerRoot "stderr-$RequestId.txt"
  Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
  $argLine = (($spec.Args | ForEach-Object { Quote-FixedArg ([string]$_) }) -join ' ')
  $proc = Start-Process -FilePath $Wsl -ArgumentList $argLine -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $timedOut = $false
  $timeoutKind = $null
  $idleTimeoutSec = if ($spec.PSObject.Properties.Name -contains 'IdleTimeoutSec') { [int]$spec.IdleTimeoutSec } else { 0 }
  $startedAt = Get-Date
  $lastProgressAt = $startedAt
  [long]$lastBytes = -1
  while (-not $proc.HasExited) {
    Start-Sleep -Milliseconds 1000
    $proc.Refresh()
    Write-BrokerHeartbeat
    [long]$bytes = 0
    foreach ($candidate in @($stdoutPath,$stderrPath)) {
      if (Test-Path -LiteralPath $candidate) {
        try { $bytes += [long](Get-Item -LiteralPath $candidate).Length } catch {}
      }
    }
    $now = Get-Date
    if ($bytes -gt $lastBytes) {
      $lastBytes = $bytes
      $lastProgressAt = $now
    }
    if ((($now - $startedAt).TotalSeconds) -ge [int]$spec.TimeoutSec) {
      $timedOut = $true
      $timeoutKind = 'total'
      break
    }
    if ($idleTimeoutSec -gt 0 -and (($now - $lastProgressAt).TotalSeconds) -ge $idleTimeoutSec) {
      $timedOut = $true
      $timeoutKind = 'idle'
      break
    }
  }
  if ($timedOut) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $proc.Id -Timeout 5 -ErrorAction SilentlyContinue
  }
  $proc.Refresh()
  Write-BrokerHeartbeat
  $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -Raw -LiteralPath $stdoutPath } else { '' }
  $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { '' }
  Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    exitCode = if ($timedOut) { -1 } elseif ($proc.HasExited) { [int]$proc.ExitCode } else { -1 }
    timedOut = $timedOut
    timeoutKind = $timeoutKind
    stdout = [string]$stdout
    stderr = [string]$stderr
  }
}

function Test-Request($Request) {
  if ([string]$Request.schema -ne 'TIGERIQ_PAPERCLIP_WSL_REQUEST_V1') { throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_REQUEST_INVALID' }
  if ([string]$Request.id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_REQUEST_INVALID' }
  $allowed = @('schema','id','operation')
  foreach ($property in $Request.PSObject.Properties.Name) {
    if ($allowed -notcontains [string]$property) { throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_REQUEST_INVALID' }
  }
  [void](Get-OperationSpec ([string]$Request.operation))
}

$lastHeartbeat = [DateTime]::MinValue
try {
  while ($true) {
    if (((Get-Date) - $lastHeartbeat).TotalSeconds -ge 2) {
      Write-BrokerHeartbeat
      $lastHeartbeat = Get-Date
    }

    $items = @(Get-ChildItem -LiteralPath $Requests -Filter 'request-*.json' -File -ErrorAction SilentlyContinue | Sort-Object CreationTimeUtc | Select-Object -First 3)
    foreach ($item in $items) {
      $req = $null
      try {
        $req = Get-Content -LiteralPath $item.FullName -Raw | ConvertFrom-Json
        Test-Request $req
        $result = Invoke-FixedWslDocker ([string]$req.id) ([string]$req.operation)
        $resp = [pscustomobject]@{
          schema='TIGERIQ_PAPERCLIP_WSL_RESPONSE_V1'
          id=[string]$req.id
          ok=$true
          exitCode=[int]$result.exitCode
          timedOut=[bool]$result.timedOut
          timeoutKind=if ($result.timeoutKind) { [string]$result.timeoutKind } else { $null }
          stdout=[string]$result.stdout
          stderr=[string]$result.stderr
          completedAt=(Get-Date).ToUniversalTime().ToString('o')
        }
      } catch {
        $id = if ($req -and $req.id) { [string]$req.id } else { '' }
        $resp = [pscustomobject]@{
          schema='TIGERIQ_PAPERCLIP_WSL_RESPONSE_V1'
          id=$id
          ok=$false
          exitCode=-1
          timedOut=$false
          timeoutKind=$null
          stdout=''
          stderr=[string]$_.Exception.Message
          completedAt=(Get-Date).ToUniversalTime().ToString('o')
        }
      }
      if ($req -and [string]$req.id -match '^[0-9a-f-]{36}$') {
        Write-JsonAtomic (Join-Path $Responses "response-$($req.id).json") $resp
      }
      Remove-Item -LiteralPath $item.FullName -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 200
  }
} finally {
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
