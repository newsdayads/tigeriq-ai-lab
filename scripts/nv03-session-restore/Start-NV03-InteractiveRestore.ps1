param(
  [string]$ChromePath='C:\Program Files\Google\Chrome\Application\chrome.exe',
  [string]$UserDataDir='D:\TigerIQ\Chrome\NV03-Worker\UserData',
  [string]$ProfileDirectory='Profile 3',
  [string]$HomeUrl='https://chatgpt.com/g/g-p-6a9e19b4deac8191938cca4486a7e12b-tigeriq-ai-lab/project#tigeriq-worker=NV03',
  [string]$SidecarEntry='D:\TigerIQ\Apps\NV03Sidecar\Current\nv03-isolated-sidecar.mjs',
  [string]$RuntimeDir='D:\TigerIQ\Apps\NV03Sidecar\Runtime',
  [int]$WindowLeft=2258,
  [int]$WindowTop=0,
  [int]$WindowWidth=500,
  [int]$WindowHeight=834
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'NV03-SessionRestore.psm1') -Force

$activeSession=Get-Nv03ActiveConsoleSessionId
$currentSession=[int](Get-Process -Id $PID).SessionId
if ($currentSession -ne $activeSession) {
  throw ("NV03_INTERACTIVE_SESSION_REQUIRED:current={0}:active={1}" -f $currentSession,$activeSession)
}

$snapshot=Get-Nv03RuntimeSnapshot
$state=Get-Nv03RuntimeState -Snapshot $snapshot
if ($state -eq 'HEALTHY_INTERACTIVE') {
  [pscustomobject]@{ok=$true;state=$state;activeSessionId=$activeSession;idempotent=$true;snapshot=$snapshot}|ConvertTo-Json -Depth 8 -Compress
  exit 0
}
if ($state -eq 'SCOPE_MISMATCH') {
  throw 'NV03_SCOPE_MISMATCH_REFUSE_MUTATION'
}

if ($state -eq 'WRONG_WINDOWS_SESSION') {
  Stop-Nv03ScopedRuntime -Snapshot $snapshot -WrongSessionOnly
  Start-Sleep -Seconds 2
} elseif ($state -eq 'NOT_RUNNING') {
  Stop-Nv03ScopedRuntime -Snapshot $snapshot
  Start-Sleep -Seconds 1
}

if (Get-Nv03PortOwner -Port 9223) { throw 'NV03_PORT_9223_STILL_BUSY' }
if (Get-Nv03PortOwner -Port 8823) { throw 'NV03_PORT_8823_STILL_BUSY' }

New-Item -ItemType Directory -Force -Path $RuntimeDir|Out-Null
$chromeArgs=@(
  '--remote-debugging-port=9223',
  "--user-data-dir=$UserDataDir",
  "--profile-directory=$ProfileDirectory",
  "--window-position=$WindowLeft,$WindowTop",
  "--window-size=$WindowWidth,$WindowHeight",
  '--no-first-run',
  '--new-window',
  $HomeUrl
)
Start-Process -FilePath $ChromePath -ArgumentList $chromeArgs
[void](Wait-Nv03Port -Port 9223 -Seconds 25)

$out=Join-Path $RuntimeDir 'sidecar.out.log'
$err=Join-Path $RuntimeDir 'sidecar.err.log'
Start-Process -FilePath 'node.exe' -ArgumentList @($SidecarEntry) -WorkingDirectory (Split-Path -Parent $SidecarEntry) -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
[void](Wait-Nv03Port -Port 8823 -Seconds 20)

Start-Sleep -Milliseconds 800
$final=Get-Nv03RuntimeSnapshot
$finalState=Get-Nv03RuntimeState -Snapshot $final
if ($finalState -ne 'HEALTHY_INTERACTIVE') {
  throw ('NV03_INTERACTIVE_RECOVERY_VERIFY_FAILED:'+$finalState)
}
[pscustomobject]@{
  ok=$true
  state=$finalState
  activeSessionId=$activeSession
  chromePid=$final.chrome.pid
  chromeSessionId=$final.chrome.sessionId
  sidecarPid=$final.sidecar.pid
  sidecarSessionId=$final.sidecar.sessionId
  ports=@(9223,8823)
  window=@{left=$WindowLeft;top=$WindowTop;width=$WindowWidth;height=$WindowHeight}
}|ConvertTo-Json -Depth 8 -Compress
