param([int]$IntervalSeconds=60,[int]$FailureThreshold=2,[int]$CooldownSeconds=300,[int]$UpdaterStaleSeconds=240,[int]$UpdaterStartupGraceSeconds=180)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$statePath='D:\TigerIQ\State\bootstrap-watchdog.json'
$updaterStatePath='D:\TigerIQ\State\core-runtime-updater.json'
$updaterRuntime='D:\TigerIQ\Runtime\CoreUpdater\update-core-runtime.ps1'
$updaterTask='TigerIQ Core Runtime Updater'
$watchdogStartedAt=Get-Date
$targets=@(
  @{key='updater';task=$updaterTask;ports=@()},
  @{key='openclaw';task='TigerIQ OpenClaw Gateway';ports=@(18789)},
  @{key='appchrome';task='TigerIQ APP Chrome Unified';ports=@(8798,8799)}
)
$failures=@{}
$lastHeal=@{}
foreach($t in $targets){$failures[$t.key]=0;$lastHeal[$t.key]=[DateTime]::MinValue}

function Test-Tcp([int]$port,[int]$timeoutMs=1500){
  $client=New-Object Net.Sockets.TcpClient
  try{
    $async=$client.BeginConnect('127.0.0.1',$port,$null,$null)
    if(-not $async.AsyncWaitHandle.WaitOne($timeoutMs,$false)){return $false}
    $client.EndConnect($async);return [bool]$client.Connected
  }catch{return $false}finally{$client.Close()}
}
function Get-UpdaterHeartbeat(){
  $age=$null;$fresh=$false;$reason='UPDATER_HEARTBEAT_MISSING'
  try{
    if(Test-Path -LiteralPath $updaterStatePath){
      $d=Get-Content -LiteralPath $updaterStatePath -Raw|ConvertFrom-Json -ErrorAction Stop
      $stamp=[DateTime]::Parse([string]$d.updatedAt).ToUniversalTime()
      $age=[math]::Max(0,[math]::Round(((Get-Date).ToUniversalTime()-$stamp).TotalSeconds,1))
      $fresh=[bool]($age -le $UpdaterStaleSeconds)
      $reason=if($fresh){'UPDATER_HEARTBEAT_FRESH'}else{'UPDATER_HEARTBEAT_STALE'}
    }elseif(((Get-Date)-$watchdogStartedAt).TotalSeconds -le $UpdaterStartupGraceSeconds){
      $fresh=$true;$reason='UPDATER_STARTUP_GRACE'
    }
  }catch{$fresh=$false;$reason='UPDATER_HEARTBEAT_INVALID'}
  return @{fresh=$fresh;ageSec=$age;reason=$reason}
}
function Stop-ExactUpdaterProcesses(){
  $stopped=@()
  try{
    $escaped=[regex]::Escape($updaterRuntime)
    $matches=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object{
      $_.ProcessId -ne $PID -and [string]$_.Name -match '^(powershell|pwsh)\.exe$' -and [string]$_.CommandLine -match $escaped
    })
    foreach($p in $matches){
      try{Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction Stop;$stopped+=([int]$p.ProcessId)}catch{}
    }
  }catch{}
  return @($stopped)
}
function Save-State($rows){
  New-Item -ItemType Directory -Path (Split-Path -Parent $statePath) -Force|Out-Null
  $d=[ordered]@{schema='TIGERIQ_BOOTSTRAP_WATCHDOG_V2';updatedAt=(Get-Date).ToUniversalTime().ToString('o');services=$rows}
  $tmp=$statePath+'.tmp';[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $statePath
}
function Ensure-UpdaterTask(){
  # TIGERIQ_UPDATER_TASK_SELF_HEAL_V1: outer recovery removes the post-reboot deadlock where
  # Remote Guard needs the updater but the updater task itself is absent.
  if(-not(Test-Path -LiteralPath $updaterRuntime)){return @{action='blocked';reason='UPDATER_RUNTIME_MISSING'}}
  try{
    $task=Get-ScheduledTask -TaskName $updaterTask -ErrorAction SilentlyContinue
    if($task){return @{action='none';reason='TASK_PRESENT'}}
    $ps='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $args="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$updaterRuntime`" -IntervalSeconds 120"
    $action=New-ScheduledTaskAction -Execute $ps -Argument $args
    $trigger=New-ScheduledTaskTrigger -AtStartup
    $settings=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances StopExisting
    $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $updaterTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force|Out-Null
    Start-ScheduledTask -TaskName $updaterTask -ErrorAction Stop
    return @{action='installed';reason='UPDATER_TASK_RECREATED'}
  }catch{return @{action='blocked';reason=('UPDATER_TASK_RECREATE_'+$_.Exception.GetType().Name)}}
}
while($true){
  $rows=@()
  foreach($t in $targets){
    $task=Get-ScheduledTask -TaskName $t.task -ErrorAction SilentlyContinue
    $bootstrapRepair=@{action='none';reason='NOT_APPLICABLE'}
    if($t.key -eq 'updater' -and -not $task){
      $bootstrapRepair=Ensure-UpdaterTask
      $task=Get-ScheduledTask -TaskName $t.task -ErrorAction SilentlyContinue
    }
    $taskRunning=[bool]($task -and [string]$task.State -eq 'Running')
    $portsHealthy=$true
    foreach($p in @($t.ports)){if(-not(Test-Tcp ([int]$p))){$portsHealthy=$false;break}}
    $heartbeat=if($t.key -eq 'updater'){Get-UpdaterHeartbeat}else{@{fresh=$true;ageSec=$null;reason='NOT_APPLICABLE'}}
    $healthy=$taskRunning -and $portsHealthy -and [bool]$heartbeat.fresh
    $action=if([string]$bootstrapRepair.action -eq 'installed'){'install'}elseif([string]$bootstrapRepair.action -eq 'blocked'){'blocked'}else{'none'}
    $reason=if([string]$bootstrapRepair.action -eq 'installed'){'UPDATER_TASK_RECREATED'}elseif([string]$bootstrapRepair.action -eq 'blocked'){[string]$bootstrapRepair.reason}elseif($healthy){'HEALTHY'}elseif(-not $task){'TASK_MISSING'}elseif(-not $taskRunning){'TASK_NOT_RUNNING'}elseif(-not [bool]$heartbeat.fresh){[string]$heartbeat.reason}else{'PORT_UNHEALTHY'}
    $stoppedPids=@()
    if($healthy){$failures[$t.key]=0}
    else{
      $failures[$t.key]=[int]$failures[$t.key]+1
      $since=((Get-Date)-[DateTime]$lastHeal[$t.key]).TotalSeconds
      if([string]$bootstrapRepair.action -ne 'blocked' -and $task -and $failures[$t.key] -ge $FailureThreshold -and $since -ge $CooldownSeconds){
        try{
          if($taskRunning -and ($t.key -eq 'updater' -or @($t.ports).Count)){Stop-ScheduledTask -TaskName $t.task -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2}
          if($t.key -eq 'updater'){$stoppedPids=@(Stop-ExactUpdaterProcesses)}
          Start-ScheduledTask -TaskName $t.task -ErrorAction Stop
          $lastHeal[$t.key]=Get-Date;$failures[$t.key]=0;$action='restart'
          $reason=if($t.key -eq 'updater'){'STALE_UPDATER_SELF_HEAL'}else{'BOUNDED_SELF_HEAL'}
        }catch{$action='blocked';$reason=('SELF_HEAL_'+$_.Exception.GetType().Name)}
      }
    }
    $rows+=@{key=$t.key;task=$t.task;healthy=$healthy;taskRunning=$taskRunning;portsHealthy=$portsHealthy;heartbeatFresh=[bool]$heartbeat.fresh;heartbeatAgeSec=$heartbeat.ageSec;failures=[int]$failures[$t.key];action=$action;reason=$reason;stoppedUpdaterPids=$stoppedPids}
  }
  try{Save-State $rows}catch{}
  Start-Sleep -Seconds $IntervalSeconds
}
