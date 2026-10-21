$ErrorActionPreference='Stop'

$TaskName='TigerIQ Paperclip WSL Broker'
$LabRoot='D:\TigerIQ-Paperclip-Lab'
$BrokerRoot=Join-Path $LabRoot 'broker'
$Broker=Join-Path $BrokerRoot 'paperclip-wsl-broker.ps1'
$Heartbeat=Join-Path $BrokerRoot 'heartbeat.json'
$ExpectedBrokerVersion='1.7-openai-device-auth'
$InstallStartedAt=(Get-Date).ToUniversalTime()

if(-not (Test-Path -LiteralPath $Broker -PathType Leaf)){ throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_SCRIPT_MISSING' }
$ExpectedBrokerSha256=(Get-FileHash -LiteralPath $Broker -Algorithm SHA256).Hash.ToLowerInvariant()
$user=(Get-CimInstance Win32_ComputerSystem).UserName
if([string]::IsNullOrWhiteSpace($user)){ throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_INTERACTIVE_USER_NOT_FOUND' }

$action=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Broker`""
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)

$existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
# An identical, healthy interactive broker must not be stopped by R07 retry.
# Match the running startup source SHA, authenticated interactive user, and
# a fresh keepalive. Stale, foreign or malformed heartbeats cannot short-circuit.
if($existing -and [string]$existing.State -eq 'Running' -and (Test-Path -LiteralPath $Heartbeat -PathType Leaf)){
  try {
    $live=Get-Content -Raw -LiteralPath $Heartbeat | ConvertFrom-Json
    $liveAt=[DateTime]::Parse([string]$live.at).ToUniversalTime()
    $ageSec=($InstallStartedAt - $liveAt).TotalSeconds
    $expectedUserName=([string]$user -split '\\')[-1]
    if([string]$live.schema -eq 'TIGERIQ_PAPERCLIP_WSL_HEARTBEAT_V1' -and
       [string]$live.version -eq $ExpectedBrokerVersion -and
       [string]$live.sourceSha256 -ceq $ExpectedBrokerSha256 -and
       [string]$live.user -ieq $expectedUserName -and
       [int]$live.sessionId -gt 0 -and
       [int]$live.pid -gt 0 -and
       [bool]$live.wslKeepaliveRunning -eq $true -and
       [int]$live.wslKeepalivePid -gt 0 -and
       $ageSec -ge -2 -and $ageSec -le 15){
      Write-Output ('TASK='+$TaskName)
      Write-Output ('USER='+$user)
      Write-Output ('BROKER='+$Broker)
      Write-Output ('BROKER_VERSION='+$ExpectedBrokerVersion)
      Write-Output ('BROKER_PID='+[string]$live.pid)
      Write-Output ('WSL_KEEPALIVE_PID='+[string]$live.wslKeepalivePid)
      exit 0
    }
  } catch {
    # Fall through to the existing bounded reinstallation lifecycle.
  }
}
if($existing){
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  for($i=0;$i -lt 40;$i++){
    Start-Sleep -Milliseconds 250
    $state=(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State
    if([string]$state -ne 'Running'){ break }
  }
  if([string]((Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State) -eq 'Running'){
    throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_STOP_TIMEOUT'
  }
}
Remove-Item -LiteralPath $Heartbeat -Force -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$ready=$false
for($i=0;$i -lt 80;$i++){
  Start-Sleep -Milliseconds 250
  if(Test-Path -LiteralPath $Heartbeat -PathType Leaf){
    try {
      $h=Get-Content -Raw -LiteralPath $Heartbeat | ConvertFrom-Json
      $heartbeatAt=[DateTime]::Parse([string]$h.at).ToUniversalTime()
      if([string]$h.schema -eq 'TIGERIQ_PAPERCLIP_WSL_HEARTBEAT_V1' -and
         [string]$h.version -eq $ExpectedBrokerVersion -and
         [string]$h.sourceSha256 -ceq $ExpectedBrokerSha256 -and
         [string]$h.user -and
         [int]$h.pid -gt 0 -and
         [bool]$h.wslKeepaliveRunning -eq $true -and
         [int]$h.wslKeepalivePid -gt 0 -and
         $heartbeatAt -ge $InstallStartedAt){
        $ready=$true
        break
      }
    } catch {}
  }
}
if(-not $ready){ throw 'TIGERIQ_PAPERCLIP_WSL_BROKER_HEARTBEAT_TIMEOUT' }
Write-Output ('TASK='+$TaskName)
Write-Output ('USER='+$user)
Write-Output ('BROKER='+$Broker)
Write-Output ('BROKER_VERSION='+$ExpectedBrokerVersion)
Write-Output ('BROKER_PID='+[string]$h.pid)
Write-Output ('WSL_KEEPALIVE_PID='+[string]$h.wslKeepalivePid)
