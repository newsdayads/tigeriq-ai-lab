param(
  [string]$RepoPath='F:\TigerIQ\Workspace\tigeriq-ai-lab',
  [string]$ExpectedBranch='wo065/continuous-operations-v1',
  [string]$ExecutionWorkspace='F:\TigerIQ\Workspace\tigeriq-ai-lab',
  [switch]$SkipRepositoryTests
)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
function Fail([string]$Code,[string]$Message){throw "$Code`: $Message"}
if($env:COMPUTERNAME -ne 'PC01'){Fail 'WRONG_HOST' 'Continuous Operations installer is pinned to PC01'}
$id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id);if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Fail 'ADMIN_REQUIRED' 'Run PowerShell as Administrator'}
foreach($p in @($RepoPath,$ExecutionWorkspace)){if(-not(Test-Path $p)){Fail 'REQUIRED_PATH_MISSING' $p}}
$git=(Get-Command git.exe -ErrorAction Stop).Source;$node=(Get-Command node.exe -ErrorAction Stop).Source;$npm=(Get-Command npm.cmd -ErrorAction Stop).Source;$powershell=(Get-Command powershell.exe -ErrorAction Stop).Source
$branch=(& $git -C $RepoPath branch --show-current).Trim();if($branch -ne $ExpectedBranch){Fail 'WRONG_BRANCH' "Expected $ExpectedBranch; got $branch"};$dirty=@(& $git -C $RepoPath status --porcelain);if($dirty.Count -gt 0){Fail 'REPO_NOT_CLEAN' (($dirty|Select-Object -First 10)-join '; ')}
if(-not $SkipRepositoryTests){Push-Location $RepoPath;try{& $npm ci;if($LASTEXITCODE -ne 0){Fail 'NPM_CI_FAILED' 'npm ci failed'};& $npm run typecheck;if($LASTEXITCODE -ne 0){Fail 'TYPECHECK_FAILED' 'npm run typecheck failed'};& $npm test;if($LASTEXITCODE -ne 0){Fail 'TEST_FAILED' 'npm test failed'};& $npm run build;if($LASTEXITCODE -ne 0){Fail 'BUILD_FAILED' 'npm run build failed'}}finally{Pop-Location}}
$Entry=Join-Path $RepoPath 'dist\apps\continuous-operations\src\standalone.js';if(-not(Test-Path $Entry)){Fail 'CONTINUOUS_BUILD_MISSING' $Entry}
$RuntimeDir='F:\TigerIQ\Runtime\continuous-operations-v1';$Goals=Join-Path $RuntimeDir 'goals.json';$Control=Join-Path $RuntimeDir 'control.json';$State=Join-Path $RuntimeDir 'state.json';$Runner=Join-Path $RuntimeDir 'run-continuous-operations-v1.ps1';$Log='F:\TigerIQ\Logs\continuous-operations-v1.log';$Task='TigerIQ Continuous Operations'
$MissionInbox='F:\TigerIQ\Runtime\mission-orchestrator-v1\mission-inbox.json';$MissionState='F:\TigerIQ\Runtime\mission-orchestrator-v1\mission-state.json';if(-not(Test-Path $MissionInbox)){Fail 'MISSION_INBOX_MISSING' $MissionInbox}
$SupervisorRunner='F:\TigerIQ\Runtime\autonomy-supervisor-v1\run-autonomy-supervisor-v1.ps1';$SupervisorTask='TigerIQ Autonomy Supervisor';if(-not(Test-Path $SupervisorRunner)){Fail 'SUPERVISOR_RUNNER_MISSING' $SupervisorRunner}
$supervisorRaw=Get-Content $SupervisorRunner -Raw;$oldTaskList='$taskNames=@(''TigerIQ Workforce Controller'',''TigerIQ PC01 Native Worker'',''TigerIQ Autonomous Planner'',''TigerIQ Mission Orchestrator'')';$newTaskList='$taskNames=@(''TigerIQ Workforce Controller'',''TigerIQ PC01 Native Worker'',''TigerIQ Autonomous Planner'',''TigerIQ Mission Orchestrator'',''TigerIQ Continuous Operations'')';if($supervisorRaw -notmatch [regex]::Escape('TigerIQ Continuous Operations')){if($supervisorRaw -notmatch [regex]::Escape($oldTaskList)){Fail 'SUPERVISOR_PATCH_GUARD_FAILED' 'Expected supervisor task list not found'};$supervisorRaw=$supervisorRaw.Replace($oldTaskList,$newTaskList)}
New-Item -ItemType Directory -Force -Path $RuntimeDir,(Split-Path $Log -Parent)|Out-Null
$utf8=New-Object Text.UTF8Encoding($false);if(-not(Test-Path $Goals)){[IO.File]::WriteAllText($Goals,'{"version":1,"goals":[]}',$utf8)};if(-not(Test-Path $Control)){[IO.File]::WriteAllText($Control,'{"version":1,"paused":false}',$utf8)};if(-not(Test-Path $State)){[IO.File]::WriteAllText($State,'{"version":1,"goals":{},"paused":false}',$utf8)}
$repoEsc=$RepoPath.Replace("'","''");$entryEsc=$Entry.Replace("'","''");$logEsc=$Log.Replace("'","''");$nodeEsc=$node.Replace("'","''");$goalsEsc=$Goals.Replace("'","''");$controlEsc=$Control.Replace("'","''");$stateEsc=$State.Replace("'","''")
$runnerContent=@"
`$ErrorActionPreference='Stop'
`$env:TIGERIQ_CONTINUOUS_RUNTIME='$RuntimeDir'
`$env:TIGERIQ_CONTINUOUS_GOALS='$goalsEsc'
`$env:TIGERIQ_CONTINUOUS_CONTROL='$controlEsc'
`$env:TIGERIQ_CONTINUOUS_STATE='$stateEsc'
`$env:TIGERIQ_MISSION_INBOX='$MissionInbox'
`$env:TIGERIQ_MISSION_STATE='$MissionState'
`$env:TIGERIQ_CONTINUOUS_INTERVAL_MS='5000'
Set-Location '$repoEsc'
& '$nodeEsc' '$entryEsc' *>> '$logEsc'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($Runner,$runnerContent,$utf8);[IO.File]::WriteAllText($SupervisorRunner,$supervisorRaw,$utf8)
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 50 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew;$taskPrincipal=New-ScheduledTaskPrincipal -UserId $id.Name -LogonType S4U -RunLevel Highest;$startup=New-ScheduledTaskTrigger -AtStartup
$existing=Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue;if($existing){Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $Task -Confirm:$false};$action=New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Runner`"";Register-ScheduledTask -TaskName $Task -Action $action -Trigger $startup -Settings $settings -Principal $taskPrincipal|Out-Null;Start-ScheduledTask -TaskName $Task
if(Get-ScheduledTask -TaskName $SupervisorTask -ErrorAction SilentlyContinue){Stop-ScheduledTask -TaskName $SupervisorTask -ErrorAction SilentlyContinue;Start-ScheduledTask -TaskName $SupervisorTask}
$installStarted=(Get-Date).ToUniversalTime();$deadline=(Get-Date).AddSeconds(90);$ready=$false;$taskState=$null;do{$taskState=Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue;if($null -ne $taskState -and (Test-Path $State)){try{$s=Get-Content $State -Raw|ConvertFrom-Json;if($s.lastCycleAt){$t=[datetime]::Parse([string]$s.lastCycleAt).ToUniversalTime();$ready=($t -ge $installStarted -and $taskState.State -eq 'Running')}}catch{}};if($ready){break};Start-Sleep -Seconds 2}while((Get-Date)-lt $deadline)
if(-not $ready){$tail='';if(Test-Path $Log){$tail=((Get-Content $Log -Tail 12)-join ' | ')};$taskText=if($null -eq $taskState){'MISSING'}else{[string]$taskState.State};Fail 'CONTINUOUS_START_TIMEOUT' "Continuous Operations did not produce fresh state. task=$taskText; log=$tail"}
[ordered]@{ok=$true;status='PC01_CONTINUOUS_OPERATIONS_INSTALLED';branch=$branch;task=$Task;goals=$Goals;control=$Control;state=$State;missionInbox=$MissionInbox;supervisorPatched=$true;mainProductionTouched=$false;financialActionExecuted=$false;secretPrinted=$false}|ConvertTo-Json -Compress
