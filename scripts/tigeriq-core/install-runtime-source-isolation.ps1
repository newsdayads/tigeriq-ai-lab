param([Parameter(Mandatory=$true)][string]$ExpectedSha)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$baseDir = if ($env:TIGERIQ_BASE_DIR) { $env:TIGERIQ_BASE_DIR } else { 'D:\TigerIQ' }
$controlRepo=Join-Path $baseDir 'Workspace\tigeriq-ai-lab'
$runtimeRepo=Join-Path $baseDir 'Runtime\CoreSource'
$runtimeState=Join-Path $baseDir 'State\core-runtime-source.json'
$launcherRuntime=Join-Path $baseDir 'Runtime\CoreLaunchers'
$updaterRuntime=Join-Path $baseDir 'Runtime\CoreUpdater\update-core-runtime.ps1'
$coreTask='TigerIQ Core 24x7'
$codingTask='TigerIQ Coding Lane 24x7'
$updaterTask='TigerIQ Core Runtime Updater'

if($ExpectedSha -notmatch '^[0-9a-f]{40}$'){throw 'EXPECTED_SHA_INVALID'}
git -C $controlRepo fetch origin main --prune|Out-Null
if($LASTEXITCODE -ne 0){throw 'FETCH_FAILED'}
$remote=([string](git -C $controlRepo rev-parse origin/main 2>$null)).Trim()
if($remote -ne $ExpectedSha){throw ('REMOTE_HEAD_MISMATCH:'+ $remote)}

if(Test-Path -LiteralPath $runtimeRepo){
  $inside=([string](git -C $runtimeRepo rev-parse --is-inside-work-tree 2>$null)).Trim()
  if($LASTEXITCODE -ne 0 -or $inside -ne 'true'){throw 'RUNTIME_SOURCE_INVALID'}
  if(@(git -C $runtimeRepo status --porcelain).Count){throw 'RUNTIME_SOURCE_DIRTY'}
  $previous=([string](git -C $runtimeRepo rev-parse HEAD 2>$null)).Trim()
  git -C $runtimeRepo reset --hard $ExpectedSha|Out-Null
  if($LASTEXITCODE -ne 0){throw 'RUNTIME_SOURCE_RESET_FAILED'}
}else{
  $previous=$null
  New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeRepo) -Force|Out-Null
  git -C $controlRepo worktree add --detach $runtimeRepo $ExpectedSha|Out-Null
  if($LASTEXITCODE -ne 0){throw 'RUNTIME_SOURCE_CREATE_FAILED'}
}

New-Item -ItemType Directory -Path $launcherRuntime -Force|Out-Null
foreach($name in @('run-core.ps1','run-coding-lane.ps1')){
  $source=Join-Path $runtimeRepo ('scripts\tigeriq-core\'+$name)
  if(-not(Test-Path -LiteralPath $source)){throw ('LAUNCHER_SOURCE_MISSING:'+ $name)}
  $target=Join-Path $launcherRuntime $name
  $tmp=$target+'.tmp'
  Copy-Item -LiteralPath $source -Destination $tmp -Force
  Move-Item -LiteralPath $tmp -Destination $target -Force
}
$updaterSource=Join-Path $runtimeRepo 'scripts\tigeriq-core\update-core-runtime.ps1'
if(-not(Test-Path -LiteralPath $updaterSource)){throw 'UPDATER_SOURCE_MISSING'}
New-Item -ItemType Directory -Path (Split-Path -Parent $updaterRuntime) -Force|Out-Null
Copy-Item -LiteralPath $updaterSource -Destination ($updaterRuntime+'.tmp') -Force
Move-Item -LiteralPath ($updaterRuntime+'.tmp') -Destination $updaterRuntime -Force

$manifest=[ordered]@{
  schema='TIGERIQ_RUNTIME_SOURCE_V1'
  sourcePath=$runtimeRepo
  currentSha=$ExpectedSha
  previousSha=$previous
  gateSha=$ExpectedSha
  installedAt=(Get-Date).ToUniversalTime().ToString('o')
}
$tmpState=$runtimeState+'.tmp'
[IO.File]::WriteAllText($tmpState,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
Move-Item -Force $tmpState $runtimeState

function Set-TaskAction([string]$taskName,[string]$scriptPath){
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$scriptPath+'"')
  Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null
}
Set-TaskAction $coreTask (Join-Path $launcherRuntime 'run-core.ps1')
Set-TaskAction $codingTask (Join-Path $launcherRuntime 'run-coding-lane.ps1')
Set-TaskAction $updaterTask $updaterRuntime

[pscustomobject]@{
  ok=$true
  runtimeSource=$runtimeRepo
  currentSha=$ExpectedSha
  previousSha=$previous
  coreLauncher=(Join-Path $launcherRuntime 'run-core.ps1')
  codingLauncher=(Join-Path $launcherRuntime 'run-coding-lane.ps1')
  updater=$updaterRuntime
}|ConvertTo-Json -Compress
