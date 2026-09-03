param(
  [string]$RepoPath = 'F:\TigerIQ\Workspace\tigeriq-ai-lab',
  [string]$ExpectedBranch = 'wo057/pc01-primary-ai-compute-node',
  [switch]$SkipRepositoryTests
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$ControllerTask='TigerIQ Workforce Controller'
$WorkerTask='TigerIQ PC01 Native Worker'
$ControllerRunner='F:\TigerIQ\Runtime\workforce-controller-v1\run-workforce-controller-v1.ps1'
$RuntimeDir='F:\TigerIQ\Runtime\pc01-native-worker'
$StateDir=Join-Path $RuntimeDir 'state'
$SecretDir='F:\TigerIQ\Secrets'
$TokenFile=Join-Path $SecretDir 'pc01-primary-node.ingress-token'
$WorkerRunner=Join-Path $RuntimeDir 'run-pc01-native-worker.ps1'
$WorkerLog='F:\TigerIQ\Logs\pc01-native-worker.log'
$ControllerUrl='http://100.97.23.87:8790'
$OllamaUrl='http://127.0.0.1:11434'

function Fail([string]$Code,[string]$Message){throw "$Code`: $Message"}
function Protect-File([string]$Path,[string]$User){
  $acl=New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true,$false)
  foreach($identity in @('SYSTEM','BUILTIN\Administrators',$User)){try{$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))}catch{}}
  Set-Acl -Path $Path -AclObject $acl
}
function Protect-Directory([string]$Path,[string]$User){
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  foreach($identity in @('SYSTEM','BUILTIN\Administrators',$User)){try{$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}catch{}}
  Set-Acl -Path $Path -AclObject $acl
}
function Wait-Controller([int]$Seconds=90){
  $deadline=(Get-Date).AddSeconds($Seconds)
  do{try{$status=Invoke-RestMethod -Uri "$ControllerUrl/api/v1/status" -Method Get -TimeoutSec 5;if($status.ok -and $status.postgres){return $status}}catch{};Start-Sleep -Seconds 2}while((Get-Date)-lt $deadline)
  Fail 'CONTROLLER_HEALTH_TIMEOUT' 'Controller did not become healthy.'
}

if($env:COMPUTERNAME -ne 'PC01'){Fail 'WRONG_HOST' 'Installer is pinned to PC01.'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($identity)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Fail 'ADMIN_REQUIRED' 'Run once in an authorized elevated context.'}
$userName=$identity.Name
if(-not (Test-Path (Join-Path $RepoPath '.git'))){Fail 'REPO_MISSING' "Repository missing at $RepoPath"}
$git=(Get-Command git.exe -ErrorAction Stop).Source;$node=(Get-Command node.exe -ErrorAction Stop).Source;$npm=(Get-Command npm.cmd -ErrorAction Stop).Source
$branch=(& $git -C $RepoPath branch --show-current).Trim();if($branch -ne $ExpectedBranch){Fail 'WRONG_BRANCH' "Expected $ExpectedBranch; current $branch"}
if($branch -in @('main','master','production','prod')){Fail 'PROTECTED_BRANCH' 'Refusing installation from protected branch.'}
$dirty=& $git -C $RepoPath status --porcelain;if($LASTEXITCODE -ne 0 -or $dirty){Fail 'REPO_NOT_CLEAN' 'Repository must be clean before physical install.'}
$head=(& $git -C $RepoPath rev-parse HEAD).Trim()

$controllerTaskObject=Get-ScheduledTask -TaskName $ControllerTask -ErrorAction SilentlyContinue;if(-not $controllerTaskObject){Fail 'CONTROLLER_TASK_MISSING' 'Canonical Workforce Controller task is missing.'}
if(-not (Test-Path $ControllerRunner)){Fail 'CONTROLLER_RUNNER_MISSING' 'Canonical Controller runner is missing.'}
try{$ollamaTags=Invoke-RestMethod -Uri "$OllamaUrl/api/tags" -Method Get -TimeoutSec 10}catch{Fail 'OLLAMA_UNAVAILABLE' $_.Exception.Message}
$modelNames=@($ollamaTags.models|ForEach-Object{$_.name});if($modelNames -notcontains 'qwen3:8b'){Fail 'QWEN3_8B_MISSING' 'qwen3:8b is not installed; installer will not download models automatically.'}

Push-Location $RepoPath
try{
  & $npm ci --no-audit --no-fund;if($LASTEXITCODE -ne 0){Fail 'NPM_CI_FAILED' 'npm ci failed'}
  if(-not $SkipRepositoryTests){& $npm run typecheck;if($LASTEXITCODE -ne 0){Fail 'TYPECHECK_FAILED' 'typecheck failed'};& $npm test;if($LASTEXITCODE -ne 0){Fail 'UNIT_TEST_FAILED' 'unit tests failed'}}
  & $npm run build;if($LASTEXITCODE -ne 0){Fail 'BUILD_FAILED' 'build failed'}
}finally{Pop-Location}
$workerEntry=Join-Path $RepoPath 'dist\apps\pc01-native-worker\src\standalone.js';if(-not (Test-Path $workerEntry)){Fail 'WORKER_BUILD_MISSING' 'Native Worker build artifact missing.'}

New-Item -ItemType Directory -Force -Path $RuntimeDir,$StateDir,$SecretDir,(Split-Path $WorkerLog -Parent)|Out-Null
Protect-Directory $RuntimeDir $userName
if(-not (Test-Path $TokenFile)){
  $bytes=New-Object byte[] 48;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes)}finally{$rng.Dispose()};$token=[Convert]::ToBase64String($bytes);[IO.File]::WriteAllText($TokenFile,$token,(New-Object Text.UTF8Encoding($false)))
}
Protect-File $TokenFile $userName
$token=[IO.File]::ReadAllText($TokenFile).Trim();if($token.Length -lt 32){Fail 'INGRESS_TOKEN_INVALID' 'Stored ingress token is invalid.'}

$controllerContent=[IO.File]::ReadAllText($ControllerRunner)
if($controllerContent -notmatch 'TIGERIQ_INGRESS_TOKEN'){
  $backup="$ControllerRunner.pre-wo057";if(-not (Test-Path $backup)){Copy-Item $ControllerRunner $backup -Force;Protect-File $backup $userName}
  $escapedTokenFile=$TokenFile.Replace("'","''")
  $line="`$env:TIGERIQ_INGRESS_TOKEN = [IO.File]::ReadAllText('$escapedTokenFile').Trim()"
  if($controllerContent -notmatch 'Set-Location'){Fail 'CONTROLLER_RUNNER_UNEXPECTED' 'Could not safely patch canonical Controller runner.'}
  $controllerContent=$controllerContent -replace 'Set-Location',($line+"`r`nSet-Location")
  [IO.File]::WriteAllText($ControllerRunner,$controllerContent,(New-Object Text.UTF8Encoding($false)));Protect-File $ControllerRunner $userName
}

$nodeEscaped=$node.Replace("'","''");$repoEscaped=$RepoPath.Replace("'","''");$entryEscaped=$workerEntry.Replace("'","''");$tokenEscaped=$TokenFile.Replace("'","''");$stateEscaped=$StateDir.Replace("'","''");$logEscaped=$WorkerLog.Replace("'","''")
$runner=@"
`$ErrorActionPreference='Stop'
`$env:TIGERIQ_INGRESS_TOKEN=[IO.File]::ReadAllText('$tokenEscaped').Trim()
`$env:TIGERIQ_WORKSPACE='$repoEscaped'
`$env:TIGERIQ_PC01_STATE_DIR='$stateEscaped'
`$env:TIGERIQ_CONTROLLER_URL='$ControllerUrl'
`$env:TIGERIQ_OLLAMA_URL='$OllamaUrl'
`$env:TIGERIQ_OLLAMA_MODEL='qwen3:8b'
`$env:TIGERIQ_WORKER_MAX_JOBS='4'
`$env:TIGERIQ_MIN_FREE_RAM_GB='8'
Set-Location '$repoEscaped'
& '$nodeEscaped' '$entryEscaped' *>> '$logEscaped'
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($WorkerRunner,$runner,(New-Object Text.UTF8Encoding($false)));Protect-File $WorkerRunner $userName

$existingWorker=Get-ScheduledTask -TaskName $WorkerTask -ErrorAction SilentlyContinue;if($existingWorker){Stop-ScheduledTask -TaskName $WorkerTask -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $WorkerTask -Confirm:$false}
$powershell=(Get-Command powershell.exe).Source;$action=New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$WorkerRunner`"";$startup=New-ScheduledTaskTrigger -AtStartup;$recovery=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650);$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650) -MultipleInstances IgnoreNew;$taskPrincipal=New-ScheduledTaskPrincipal -UserId $userName -LogonType S4U -RunLevel Highest
Register-ScheduledTask -TaskName $WorkerTask -Action $action -Trigger @($startup,$recovery) -Settings $settings -Principal $taskPrincipal|Out-Null

Stop-ScheduledTask -TaskName $ControllerTask -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2;Start-ScheduledTask -TaskName $ControllerTask;$status=Wait-Controller 90
Start-ScheduledTask -TaskName $WorkerTask
$deadline=(Get-Date).AddSeconds(90);do{$status=Wait-Controller 10;if($status.pc01 -and $status.pc01.online){break};Start-Sleep -Seconds 2}while((Get-Date)-lt $deadline)
if(-not ($status.pc01 -and $status.pc01.online)){Fail 'WORKER_ONLINE_TIMEOUT' 'PC01 Native Worker did not register and become healthy.'}

[ordered]@{ok=$true;status='PC01_PRIMARY_NODE_INSTALLED';branch=$branch;headSha=$head;controller=$status.controller;postgres=$status.postgres;employees=$status.workforce.employees;devices=$status.workforce.devices;pc01Online=$status.pc01.online;pc01Health=$status.pc01.health;ollamaModel='qwen3:8b';ollamaContext=4096;localAiMax=2;workerTask=$WorkerTask;controllerTask=$ControllerTask;tokenPrinted=$false;openClawDependency=$false;mainProductionTouched=$false;rollbackControllerRunner="$ControllerRunner.pre-wo057"}|ConvertTo-Json -Depth 5 -Compress
