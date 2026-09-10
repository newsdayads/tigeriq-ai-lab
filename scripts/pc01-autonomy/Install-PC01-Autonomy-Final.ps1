param([string]$RepoPath='F:\TigerIQ\Workspace\tigeriq-ai-lab',[string]$ExpectedBranch='wo060/mission-decomposition-v1',[string]$ExecutionWorkspace='F:\TigerIQ\Workspace\tigeriq-ai-lab')
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
function Fail([string]$Code,[string]$Message){throw "$Code`: $Message"}
if($env:COMPUTERNAME -ne 'PC01'){Fail 'WRONG_HOST' 'Final autonomy installer is pinned to PC01'}
$id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id);if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Fail 'ADMIN_REQUIRED' 'Run PowerShell as Administrator'}
foreach($p in @($RepoPath,$ExecutionWorkspace)){if(-not(Test-Path $p)){Fail 'REQUIRED_PATH_MISSING' $p}}
$git=(Get-Command git.exe -ErrorAction Stop).Source;$node=(Get-Command node.exe -ErrorAction Stop).Source;$powershell=(Get-Command powershell.exe -ErrorAction Stop).Source
$branch=(& $git -C $RepoPath branch --show-current).Trim();if($branch -ne $ExpectedBranch){Fail 'WRONG_BRANCH' "Expected $ExpectedBranch; got $branch"};$dirty=@(& $git -C $RepoPath status --porcelain);if($dirty.Count -gt 0){Fail 'REPO_NOT_CLEAN' (($dirty|Select-Object -First 10)-join '; ')}
$plannerInstaller=Join-Path $RepoPath 'scripts\pc01-autonomy\Install-PC01-AutonomousPlanner.ps1';if(-not(Test-Path $plannerInstaller)){Fail 'PLANNER_INSTALLER_MISSING' $plannerInstaller}
& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $plannerInstaller -RepoPath $RepoPath -ExpectedBranch $ExpectedBranch -ExecutionWorkspace $ExecutionWorkspace -SkipRepositoryTests;if($LASTEXITCODE -ne 0){Fail 'PLANNER_INSTALL_FAILED' 'Autonomous Planner install failed'}
$Entry=Join-Path $RepoPath 'dist\apps\mission-orchestrator\src\standalone.js';if(-not(Test-Path $Entry)){Fail 'MISSION_BUILD_MISSING' $Entry}
$RuntimeDir='F:\TigerIQ\Runtime\mission-orchestrator-v1';$Inbox=Join-Path $RuntimeDir 'mission-inbox.json';$MissionState=Join-Path $RuntimeDir 'mission-state.json';$MissionRunner=Join-Path $RuntimeDir 'run-mission-orchestrator-v1.ps1';$MissionLog='F:\TigerIQ\Logs\mission-orchestrator-v1.log';$MissionTask='TigerIQ Mission Orchestrator'
$SupervisorDir='F:\TigerIQ\Runtime\autonomy-supervisor-v1';$SupervisorRunner=Join-Path $SupervisorDir 'run-autonomy-supervisor-v1.ps1';$SupervisorState=Join-Path $SupervisorDir 'status.json';$SupervisorLog='F:\TigerIQ\Logs\autonomy-supervisor-v1.log';$SupervisorTask='TigerIQ Autonomy Supervisor'
New-Item -ItemType Directory -Force -Path $RuntimeDir,$SupervisorDir,(Split-Path $MissionLog -Parent)|Out-Null;if(-not(Test-Path $Inbox)){[IO.File]::WriteAllText($Inbox,'{"version":1,"missions":[]}',(New-Object Text.UTF8Encoding($false)))}
$repoEsc=$RepoPath.Replace("'","''");$entryEsc=$Entry.Replace("'","''");$inboxEsc=$Inbox.Replace("'","''");$stateEsc=$MissionState.Replace("'","''");$missionLogEsc=$MissionLog.Replace("'","''");$nodeEsc=$node.Replace("'","''")
$missionContent=@"
`$ErrorActionPreference='Stop'
`$env:TIGERIQ_MISSION_RUNTIME='$RuntimeDir'
`$env:TIGERIQ_MISSION_INBOX='$inboxEsc'
`$env:TIGERIQ_MISSION_STATE='$stateEsc'
`$env:TIGERIQ_AUTONOMY_BACKLOG='F:\TigerIQ\Runtime\autonomous-planner-v1\backlog.json'
`$env:TIGERIQ_AUTONOMY_STATE='F:\TigerIQ\Runtime\autonomous-planner-v1\planner-state.json'
`$env:TIGERIQ_OLLAMA_URL='http://127.0.0.1:11434'
`$env:TIGERIQ_MISSION_MODEL='qwen3:8b'
`$env:TIGERIQ_MISSION_INTERVAL_MS='5000'
Set-Location '$repoEsc'
& '$nodeEsc' '$entryEsc' *>> '$missionLogEsc'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($MissionRunner,$missionContent,(New-Object Text.UTF8Encoding($false)))
$supervisorContent=@"
`$ErrorActionPreference='Continue'
`$taskNames=@('TigerIQ Workforce Controller','TigerIQ PC01 Native Worker','TigerIQ Autonomous Planner','TigerIQ Mission Orchestrator')
while(`$true){
  `$states=[ordered]@{}
  foreach(`$name in `$taskNames){`$t=Get-ScheduledTask -TaskName `$name -ErrorAction SilentlyContinue;if(`$null -eq `$t){`$states[`$name]='MISSING';continue};if(`$t.State -ne 'Running'){Start-ScheduledTask -TaskName `$name -ErrorAction SilentlyContinue;Start-Sleep -Milliseconds 500;`$t=Get-ScheduledTask -TaskName `$name -ErrorAction SilentlyContinue};`$states[`$name]=[string]`$t.State}
  try{`$health=Invoke-RestMethod -Uri 'http://100.97.23.87:8790/api/v1/status' -Method Get -TimeoutSec 10}catch{`$health=`$null}
  try{`$ollama=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -Method Get -TimeoutSec 10}catch{`$ollama=`$null}
  `$allTasksRunning=(`$states.Values|Where-Object{`$_ -ne 'Running'}).Count -eq 0
  `$obj=[ordered]@{updatedAt=(Get-Date).ToUniversalTime().ToString('o');tasks=`$states;controllerOk=[bool](`$health -and `$health.ok);postgresOk=[bool](`$health -and `$health.postgres);pc01Online=[bool](`$health -and `$health.pc01.online);pc01Health=if(`$health){[string]`$health.pc01.health}else{'unknown'};ollamaOk=[bool](`$ollama);allTasksRunning=[bool]`$allTasksRunning;overallOk=[bool](`$allTasksRunning -and `$health -and `$health.ok -and `$health.postgres -and `$health.pc01.online -and `$ollama)}
  [IO.File]::WriteAllText('$SupervisorState',(`$obj|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding(`$false)))
  Start-Sleep -Seconds 10
}
"@
[IO.File]::WriteAllText($SupervisorRunner,$supervisorContent,(New-Object Text.UTF8Encoding($false)))
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 50 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew;$taskPrincipal=New-ScheduledTaskPrincipal -UserId $id.Name -LogonType S4U -RunLevel Highest;$startup=New-ScheduledTaskTrigger -AtStartup
$installStarted=(Get-Date).ToUniversalTime();foreach($pair in @(@($MissionTask,$MissionRunner),@($SupervisorTask,$SupervisorRunner))){$name=$pair[0];$runner=$pair[1];$existing=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;if($existing){Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $name -Confirm:$false};$action=New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`"";Register-ScheduledTask -TaskName $name -Action $action -Trigger $startup -Settings $settings -Principal $taskPrincipal|Out-Null;Start-ScheduledTask -TaskName $name}
$deadline=(Get-Date).AddSeconds(120);$missionReady=$false;$supervisorReady=$false;do{$missionTaskState=Get-ScheduledTask -TaskName $MissionTask -ErrorAction SilentlyContinue;$supervisorTaskState=Get-ScheduledTask -TaskName $SupervisorTask -ErrorAction SilentlyContinue;if(Test-Path $MissionState){try{$ms=Get-Content $MissionState -Raw|ConvertFrom-Json;if($ms.lastCycleAt){$mt=[datetime]::Parse([string]$ms.lastCycleAt).ToUniversalTime();$missionReady=($mt -ge $installStarted -and $missionTaskState.State -eq 'Running')}}catch{}};if(Test-Path $SupervisorState){try{$ss=Get-Content $SupervisorState -Raw|ConvertFrom-Json;if($ss.updatedAt){$st=[datetime]::Parse([string]$ss.updatedAt).ToUniversalTime();$supervisorReady=($st -ge $installStarted -and [bool]$ss.overallOk -and $supervisorTaskState.State -eq 'Running')}}catch{}};if($missionReady -and $supervisorReady){break};Start-Sleep -Seconds 2}while((Get-Date)-lt $deadline)
if(-not $missionReady){$tail='';if(Test-Path $MissionLog){$tail=((Get-Content $MissionLog -Tail 12)-join ' | ')};Fail 'MISSION_START_TIMEOUT' "Mission Orchestrator did not produce fresh state. task=$($missionTaskState.State); log=$tail"};if(-not $supervisorReady){Fail 'SUPERVISOR_START_TIMEOUT' "Autonomy Supervisor did not become freshly healthy. task=$($supervisorTaskState.State)"}
[ordered]@{ok=$true;status='PC01_AUTONOMY_FINAL_INSTALLED';branch=$branch;codeRepo=$RepoPath;executionWorkspace=$ExecutionWorkspace;planner='TigerIQ Autonomous Planner';missionOrchestrator=$MissionTask;supervisor=$SupervisorTask;missionInbox=$Inbox;missionState=$MissionState;supervisorState=$SupervisorState;mainProductionTouched=$false;secretPrinted=$false}|ConvertTo-Json -Compress
