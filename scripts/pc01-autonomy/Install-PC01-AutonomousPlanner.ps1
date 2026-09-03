param([string]$RepoPath='F:\TigerIQ\Workspace\tigeriq-ai-lab',[string]$ExpectedBranch='wo059/authorization-engine-v1',[string]$ExecutionWorkspace='F:\TigerIQ\Workspace\tigeriq-ai-lab',[switch]$SkipRepositoryTests)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$TaskName='TigerIQ Autonomous Planner';$RuntimeDir='F:\TigerIQ\Runtime\autonomous-planner-v1';$Backlog=Join-Path $RuntimeDir 'backlog.json';$State=Join-Path $RuntimeDir 'planner-state.json';$Authorizations=Join-Path $RuntimeDir 'authorizations.json';$Runner=Join-Path $RuntimeDir 'run-autonomous-planner-v1.ps1';$Log='F:\TigerIQ\Logs\autonomous-planner-v1.log';$TokenFile='F:\TigerIQ\Secrets\pc01-primary-node.ingress-token';$ControllerUrl='http://100.97.23.87:8790';$Template=Join-Path $RepoPath 'config\autonomy\backlog.template.json'
function Fail([string]$Code,[string]$Message){throw "$Code`: $Message"}
function Status(){try{return Invoke-RestMethod -Uri "$ControllerUrl/api/v1/status" -Method Get -TimeoutSec 10}catch{return $null}}
if($env:COMPUTERNAME -ne 'PC01'){Fail 'WRONG_HOST' 'Installer is pinned to PC01'}
$id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id);if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Fail 'ADMIN_REQUIRED' 'Run PowerShell as Administrator'}
foreach($p in @($RepoPath,$ExecutionWorkspace,$Template,$TokenFile)){if(-not(Test-Path $p)){Fail 'REQUIRED_PATH_MISSING' $p}}
$git=(Get-Command git.exe -ErrorAction Stop).Source;$npm=(Get-Command npm.cmd -ErrorAction Stop).Source;$node=(Get-Command node.exe -ErrorAction Stop).Source;$powershell=(Get-Command powershell.exe -ErrorAction Stop).Source
$branch=(& $git -C $RepoPath branch --show-current).Trim();if($branch -ne $ExpectedBranch){Fail 'WRONG_BRANCH' "Expected $ExpectedBranch; got $branch"};if($branch -in @('main','master','production','prod')){Fail 'PROTECTED_BRANCH' 'Protected branch denied'}
$dirty=@(& $git -C $RepoPath status --porcelain);if($dirty.Count -gt 0){Fail 'REPO_NOT_CLEAN' (($dirty|Select-Object -First 10)-join '; ')}
$before=Status;if($null -eq $before -or -not $before.ok -or -not $before.postgres -or -not $before.pc01.online){Fail 'PC01_BASELINE_UNHEALTHY' 'WO-057 baseline must remain healthy'}
Push-Location $RepoPath
try{
  & $npm ci --no-audit --no-fund;if($LASTEXITCODE -ne 0){Fail 'NPM_CI_FAILED' 'npm ci failed'}
  & $npm install --no-save --ignore-scripts --package-lock=false --no-audit --no-fund pg@8.16.3;if($LASTEXITCODE -ne 0){Fail 'PG_RUNTIME_INSTALL_FAILED' 'pg runtime dependency failed'}
  if(-not $SkipRepositoryTests){& $npm run typecheck;if($LASTEXITCODE -ne 0){Fail 'TYPECHECK_FAILED' 'typecheck failed'};& $npm test;if($LASTEXITCODE -ne 0){Fail 'UNIT_TEST_FAILED' 'unit tests failed'}}
  & $npm run build;if($LASTEXITCODE -ne 0){Fail 'BUILD_FAILED' 'build failed'}
}finally{Pop-Location}
$Entry=Join-Path $RepoPath 'dist\apps\autonomous-planner\src\standalone.js';if(-not(Test-Path $Entry)){Fail 'PLANNER_BUILD_MISSING' $Entry}
New-Item -ItemType Directory -Force -Path $RuntimeDir,(Split-Path $Log -Parent)|Out-Null
if(-not(Test-Path $Backlog)){Copy-Item $Template $Backlog -Force}
if(-not(Test-Path $Authorizations)){[IO.File]::WriteAllText($Authorizations,'{"version":1,"grants":[]}',(New-Object Text.UTF8Encoding($false)))}
$executionEsc=$ExecutionWorkspace.Replace("'","''");$entryEsc=$Entry.Replace("'","''");$backlogEsc=$Backlog.Replace("'","''");$stateEsc=$State.Replace("'","''");$authEsc=$Authorizations.Replace("'","''");$tokenEsc=$TokenFile.Replace("'","''");$logEsc=$Log.Replace("'","''");$nodeEsc=$node.Replace("'","''")
$content=@"
`$ErrorActionPreference='Stop'
`$env:TIGERIQ_WORKSPACE='$executionEsc'
`$env:TIGERIQ_CONTROLLER_URL='$ControllerUrl'
`$env:TIGERIQ_AUTONOMY_BACKLOG='$backlogEsc'
`$env:TIGERIQ_AUTONOMY_STATE='$stateEsc'
`$env:TIGERIQ_AUTONOMY_AUTHORIZATIONS='$authEsc'
`$env:TIGERIQ_INGRESS_TOKEN_FILE='$tokenEsc'
`$env:TIGERIQ_AUTONOMY_INTERVAL_MS='30000'
`$env:TIGERIQ_AUTONOMY_DISPATCH_LIMIT='2'
Set-Location '$executionEsc'
& '$nodeEsc' '$entryEsc' *>> '$logEsc'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($Runner,$content,(New-Object Text.UTF8Encoding($false)))
$existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;if($existing){Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false}
$action=New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Runner`"";$startup=New-ScheduledTaskTrigger -AtStartup;$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew;$taskPrincipal=New-ScheduledTaskPrincipal -UserId $id.Name -LogonType S4U -RunLevel Highest
$installStarted=(Get-Date).ToUniversalTime();Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $startup -Settings $settings -Principal $taskPrincipal|Out-Null;Start-ScheduledTask -TaskName $TaskName
$freshState=$false;$deadline=(Get-Date).AddSeconds(90);do{$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;if(Test-Path $State){try{$ps=Get-Content $State -Raw|ConvertFrom-Json;if($ps.lastCycleAt){$cycle=[datetime]::Parse([string]$ps.lastCycleAt).ToUniversalTime();if($cycle -ge $installStarted){$freshState=$true;break}}}catch{}};if($task -and $task.State -eq 'Ready'){Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue};Start-Sleep -Seconds 2}while((Get-Date)-lt $deadline)
if(-not $freshState){$tail='';if(Test-Path $Log){$tail=((Get-Content $Log -Tail 12)-join ' | ')};Fail 'PLANNER_START_TIMEOUT' "Planner did not produce fresh state. task=$((Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State); log=$tail"}
$taskNow=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue;if($null -eq $taskNow -or $taskNow.State -ne 'Running'){Fail 'PLANNER_NOT_RUNNING' "Planner Scheduled Task state=$($taskNow.State)"}
$after=Status;if($null -eq $after -or -not $after.ok -or -not $after.postgres -or -not $after.pc01.online){Fail 'PC01_REGRESSION' 'Controller/Worker unhealthy after planner install'}
[ordered]@{ok=$true;status='AUTHORIZATION_ENGINE_INSTALLED';branch=$branch;task=$TaskName;codeRepo=$RepoPath;executionWorkspace=$ExecutionWorkspace;plannerState=$State;backlog=$Backlog;authorizations=$Authorizations;controllerHealthy=$after.ok;postgresHealthy=$after.postgres;pc01Online=$after.pc01.online;mainProductionTouched=$false;secretPrinted=$false}|ConvertTo-Json -Compress
