$ErrorActionPreference = 'Stop'

$LabRoot = 'D:\TigerIQ-Paperclip-Lab'
$BrokerRoot = Join-Path $LabRoot 'broker'
$Requests = Join-Path $BrokerRoot 'requests'
$Responses = Join-Path $BrokerRoot 'responses'
$Heartbeat = Join-Path $BrokerRoot 'heartbeat.json'
$Wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$Distro = 'Ubuntu'
$BrokerVersion = '1.7-openai-device-auth'
$Image = 'ghcr.io/paperclipai/paperclip:2026.916.1'
$Container = 'tigeriq-paperclip-lab'
$Compose = '/mnt/d/TigerIQ-Paperclip-Lab/config/docker-compose.lab.yml'
$KeepaliveExecutable = '/usr/bin/sleep'
$KeepaliveArgument = 'infinity'
$WslKeepaliveProcess = $null
$WslKeepaliveStartedAt = $null
$DeviceAuthProcess = $null
$DeviceAuthStdout = $null
$DeviceAuthStderr = $null
$DeviceAuthSessionId = $null

New-Item -ItemType Directory -Force -Path $Requests,$Responses | Out-Null
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\TigerIQPaperclipWslBrokerV1', [ref]$created)
if (-not $created) { exit 0 }

function Write-JsonAtomic([string]$Path, $Value) {
  $tmp = "$Path.tmp-$PID"
  $Value | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Test-WslKeepaliveRunning {
  if ($null -eq $script:WslKeepaliveProcess) { return $false }
  try {
    $script:WslKeepaliveProcess.Refresh()
    return (-not $script:WslKeepaliveProcess.HasExited)
  } catch {
    return $false
  }
}

function Write-BrokerHeartbeat {
  $keepaliveRunning = Test-WslKeepaliveRunning
  Write-JsonAtomic $Heartbeat ([pscustomobject]@{
    schema='TIGERIQ_PAPERCLIP_WSL_HEARTBEAT_V1'
    version=$BrokerVersion
    at=(Get-Date).ToUniversalTime().ToString('o')
    sessionId=(Get-Process -Id $PID).SessionId
    user=[Environment]::UserName
    pid=$PID
    distro=$Distro
    wslKeepaliveRunning=[bool]$keepaliveRunning
    wslKeepalivePid=if($keepaliveRunning){ [int]$script:WslKeepaliveProcess.Id }else{ $null }
    wslKeepaliveStartedAt=if($script:WslKeepaliveStartedAt){ $script:WslKeepaliveStartedAt.ToString('o') }else{ $null }
  })
}

function Quote-FixedArg([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Start-WslKeepalive {
  if (Test-WslKeepaliveRunning) { return }
  if (-not (Test-Path -LiteralPath $Wsl -PathType Leaf)) { throw 'TIGERIQ_PAPERCLIP_LAB_WSL_BROKER_WSL_NOT_FOUND' }
  $keepaliveArgs = @('--distribution',$Distro,'--exec',$KeepaliveExecutable,$KeepaliveArgument)
  $argLine = (($keepaliveArgs | ForEach-Object { Quote-FixedArg ([string]$_) }) -join ' ')
  $script:WslKeepaliveProcess = Start-Process -FilePath $Wsl -ArgumentList $argLine -PassThru -WindowStyle Hidden
  $script:WslKeepaliveStartedAt = (Get-Date).ToUniversalTime()
  Start-Sleep -Milliseconds 250
  if (-not (Test-WslKeepaliveRunning)) { throw 'TIGERIQ_PAPERCLIP_LAB_WSL_KEEPALIVE_START_FAILED' }
}

function Stop-WslKeepalive {
  if (Test-WslKeepaliveRunning) {
    Stop-Process -Id $script:WslKeepaliveProcess.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $script:WslKeepaliveProcess.Id -Timeout 5 -ErrorAction SilentlyContinue
  }
}

function Clear-DeviceAuthFiles {
  foreach ($candidate in @($script:DeviceAuthStdout,$script:DeviceAuthStderr)) {
    if ($candidate) { Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue }
  }
  $script:DeviceAuthStdout=$null
  $script:DeviceAuthStderr=$null
  $script:DeviceAuthSessionId=$null
  $script:DeviceAuthProcess=$null
}

function Refresh-DeviceAuthCleanup {
  if ($null -eq $script:DeviceAuthProcess) { return }
  try {
    $script:DeviceAuthProcess.Refresh()
    if ($script:DeviceAuthProcess.HasExited) { Clear-DeviceAuthFiles }
  } catch { Clear-DeviceAuthFiles }
}

function Invoke-OpenAiDeviceAuth([string]$RequestId,[string]$SessionId) {
  if ($SessionId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'TIGERIQ_PAPERCLIP_OPENAI_SESSION_INVALID' }
  Refresh-DeviceAuthCleanup
  if ($null -ne $script:DeviceAuthProcess) { throw 'TIGERIQ_PAPERCLIP_OPENAI_DEVICE_AUTH_ALREADY_RUNNING' }
  $loginRoot=Join-Path (Join-Path (Join-Path (Join-Path $LabRoot 'data') 'instances') 'default') 'ai-local-logins'
  $hostHome=Join-Path $loginRoot $SessionId
  $config=Join-Path $hostHome 'config.toml'
  if (-not (Test-Path -LiteralPath $hostHome -PathType Container) -or -not (Test-Path -LiteralPath $config -PathType Leaf)) { throw 'TIGERIQ_PAPERCLIP_OPENAI_SESSION_NOT_FOUND' }
  $codexHome='/paperclip/instances/default/ai-local-logins/'+$SessionId
  $stdoutPath=Join-Path $BrokerRoot ('device-auth-'+$RequestId+'.out')
  $stderrPath=Join-Path $BrokerRoot ('device-auth-'+$RequestId+'.err')
  Remove-Item -LiteralPath $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
  $args=@('--distribution',$Distro,'--exec','docker','exec','-e',('CODEX_HOME='+$codexHome),$Container,'codex','-c','cli_auth_credentials_store="file"','login','--device-auth')
  $argLine=(($args|ForEach-Object{Quote-FixedArg ([string]$_)}) -join ' ')
  $proc=Start-Process -FilePath $Wsl -ArgumentList $argLine -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  $script:DeviceAuthProcess=$proc
  $script:DeviceAuthStdout=$stdoutPath
  $script:DeviceAuthStderr=$stderrPath
  $script:DeviceAuthSessionId=$SessionId
  $deadline=(Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $proc.Refresh()
    Write-BrokerHeartbeat
    $out=if(Test-Path -LiteralPath $stdoutPath){Get-Content -Raw -LiteralPath $stdoutPath}else{''}
    $err=if(Test-Path -LiteralPath $stderrPath){Get-Content -Raw -LiteralPath $stderrPath}else{''}
    $plain=([string]$out+[Environment]::NewLine+[string]$err) -replace '\x1B\[[0-9;]*[A-Za-z]',''
    $urlMatch=[regex]::Match($plain,'https://auth\.openai\.com/codex/device')
    $codeMatch=[regex]::Match($plain,'(?is)Enter this one-time code.*?\r?\n\s*([A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+)')
    if ($urlMatch.Success -and $codeMatch.Success) {
      $code=[string]$codeMatch.Groups[1].Value
      Set-Clipboard -Value $code
      Start-Process -FilePath ([string]$urlMatch.Value) | Out-Null
      return [pscustomobject]@{ started=$true; browserOpened=$true; codeCopied=$true; sessionId=$SessionId; expiresInMinutes=15 }
    }
    if ($proc.HasExited) { Clear-DeviceAuthFiles; throw 'TIGERIQ_PAPERCLIP_OPENAI_DEVICE_AUTH_EARLY_EXIT' }
  }
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  Clear-DeviceAuthFiles
  throw 'TIGERIQ_PAPERCLIP_OPENAI_DEVICE_AUTH_PROMPT_TIMEOUT'
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
  $operation=[string]$Request.operation
  $allowed=if($operation -eq 'openai_device_auth_start'){@('schema','id','operation','sessionId')}else{@('schema','id','operation')}
  foreach ($property in $Request.PSObject.Properties.Name) {
    if ($allowed -notcontains [string]$property) { throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_REQUEST_INVALID' }
  }
  if($operation -eq 'openai_device_auth_start'){
    if([string]$Request.sessionId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'){throw 'TIGERIQ_PAPERCLIP_OPENAI_SESSION_INVALID'}
    return
  }
  [void](Get-OperationSpec $operation)
}

$lastHeartbeat = [DateTime]::MinValue
try {
  Start-WslKeepalive
  Write-BrokerHeartbeat
  while ($true) {
    if (((Get-Date) - $lastHeartbeat).TotalSeconds -ge 2) {
      if (-not (Test-WslKeepaliveRunning)) { throw 'TIGERIQ_PAPERCLIP_LAB_WSL_KEEPALIVE_EXITED' }
      Write-BrokerHeartbeat
      $lastHeartbeat = Get-Date
    }
    Refresh-DeviceAuthCleanup

    $items = @(Get-ChildItem -LiteralPath $Requests -Filter 'request-*.json' -File -ErrorAction SilentlyContinue | Sort-Object CreationTimeUtc | Select-Object -First 3)
    foreach ($item in $items) {
      $req = $null
      try {
        $req = Get-Content -LiteralPath $item.FullName -Raw | ConvertFrom-Json
        Test-Request $req
        if([string]$req.operation -eq 'openai_device_auth_start'){
          $safe=Invoke-OpenAiDeviceAuth ([string]$req.id) ([string]$req.sessionId)
          $resp=[pscustomobject]@{
            schema='TIGERIQ_PAPERCLIP_WSL_RESPONSE_V1'; id=[string]$req.id; ok=$true; exitCode=0; timedOut=$false; timeoutKind=$null
            stdout=($safe|ConvertTo-Json -Compress); stderr=''; completedAt=(Get-Date).ToUniversalTime().ToString('o')
          }
        } else {
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
  Stop-WslKeepalive
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
