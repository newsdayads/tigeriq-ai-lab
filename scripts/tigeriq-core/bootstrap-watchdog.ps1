param([int]$IntervalSeconds=60,[int]$FailureThreshold=2,[int]$CooldownSeconds=300)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$statePath='D:\TigerIQ\State\bootstrap-watchdog.json'
$targets=@(
  @{key='updater';task='TigerIQ Core Runtime Updater';ports=@()},
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
function Save-State($rows){
  New-Item -ItemType Directory -Path (Split-Path -Parent $statePath) -Force|Out-Null
  $d=[ordered]@{schema='TIGERIQ_BOOTSTRAP_WATCHDOG_V1';updatedAt=(Get-Date).ToUniversalTime().ToString('o');services=$rows}
  $tmp=$statePath+'.tmp';[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $statePath
}
while($true){
  $rows=@()
  foreach($t in $targets){
    $task=Get-ScheduledTask -TaskName $t.task -ErrorAction SilentlyContinue
    $taskRunning=[bool]($task -and [string]$task.State -eq 'Running')
    $portsHealthy=$true
    foreach($p in @($t.ports)){if(-not(Test-Tcp ([int]$p))){$portsHealthy=$false;break}}
    $healthy=$taskRunning -and $portsHealthy
    $action='none';$reason=if($healthy){'HEALTHY'}elseif(-not $task){'TASK_MISSING'}elseif(-not $taskRunning){'TASK_NOT_RUNNING'}else{'PORT_UNHEALTHY'}
    if($healthy){$failures[$t.key]=0}
    else{
      $failures[$t.key]=[int]$failures[$t.key]+1
      $since=((Get-Date)-[DateTime]$lastHeal[$t.key]).TotalSeconds
      if($task -and $failures[$t.key] -ge $FailureThreshold -and $since -ge $CooldownSeconds){
        try{
          if($taskRunning -and @($t.ports).Count){Stop-ScheduledTask -TaskName $t.task -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2}
          Start-ScheduledTask -TaskName $t.task -ErrorAction Stop
          $lastHeal[$t.key]=Get-Date;$failures[$t.key]=0;$action='start';$reason='BOUNDED_SELF_HEAL'
        }catch{$action='blocked';$reason=('SELF_HEAL_'+$_.Exception.GetType().Name)}
      }
    }
    $rows+=@{key=$t.key;task=$t.task;healthy=$healthy;taskRunning=$taskRunning;portsHealthy=$portsHealthy;failures=[int]$failures[$t.key];action=$action;reason=$reason}
  }
  try{Save-State $rows}catch{}
  Start-Sleep -Seconds $IntervalSeconds
}
