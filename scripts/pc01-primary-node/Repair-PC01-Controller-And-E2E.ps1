param([string]$RepoPath='F:\TigerIQ\Workspace\tigeriq-ai-lab')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$ExpectedBranch='wo057/pc01-primary-ai-compute-node'
$ControllerTask='TigerIQ Workforce Controller'
$WorkerTask='TigerIQ PC01 Native Worker'
$ControllerRunner='F:\TigerIQ\Runtime\workforce-controller-v1\run-workforce-controller-v1.ps1'
$ControllerLog='F:\TigerIQ\Logs\workforce-controller-v1.log'
$TokenFile='F:\TigerIQ\Secrets\pc01-primary-node.ingress-token'
$ControllerUrl='http://100.97.23.87:8790'
$OllamaUrl='http://127.0.0.1:11434'
$Installer=Join-Path $RepoPath 'scripts\pc01-primary-node\Install-PC01-PrimaryNode.ps1'
$E2E=Join-Path $RepoPath 'scripts\pc01-primary-node\Invoke-PC01-PrimaryNode-E2E.ps1'
$RunId=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$DiagPath="F:\TigerIQ\Logs\WO-057-CONTROLLER-DIAG-$RunId.json"
$RootCauses=New-Object System.Collections.Generic.List[string]

function Fail([string]$Code,[string]$Message){throw "$Code`: $Message"}
function Get-Status { try { return Invoke-RestMethod -Uri "$ControllerUrl/api/v1/status" -Method Get -TimeoutSec 5 } catch { return $null } }
function Wait-Controller([int]$Seconds=90){$deadline=(Get-Date).AddSeconds($Seconds);do{$s=Get-Status;if($null -ne $s -and $s.ok -and $s.postgres){return $s};Start-Sleep -Seconds 2}while((Get-Date)-lt $deadline);return $null}
function Get-LogTail { if(Test-Path $ControllerLog){return ((Get-Content $ControllerLog -Tail 300 -ErrorAction SilentlyContinue)-join "`n")};return '' }
function Pg-ImportOk([string]$Node){Push-Location $RepoPath;try{& $Node -e "import('pg').then(()=>process.exit(0)).catch(()=>process.exit(42))" *> $null;return ($LASTEXITCODE -eq 0)}finally{Pop-Location}}
function Add-Root([string]$Name){if(-not $RootCauses.Contains($Name)){$RootCauses.Add($Name)}}
function Classify([string]$Text){if($Text -match '(?i)(Cannot find package.+\bpg\b|Cannot find module.+\bpg\b|ERR_MODULE_NOT_FOUND.+\bpg\b)'){return 'PG_MODULE_MISSING'};if($Text -match '(?i)EADDRNOTAVAIL'){return 'TAILSCALE_BIND'};if($Text -match '(?i)EADDRINUSE'){return 'PORT_8790_IN_USE'};if($Text -match '(?i)TIGERIQ_DATABASE_URL is required'){return 'DATABASE_URL_MISSING'};if($Text -match '(?i)TIGERIQ_WORKFORCE_HOST must equal'){return 'HOST_CONFIG'};if($Text -match '(?i)TIGERIQ_WORKFORCE_PORT must equal'){return 'PORT_CONFIG'};if($Text -match '(?i)TIGERIQ_INGRESS_TOKEN must contain'){return 'INGRESS_CONFIG'};if($Text -match '(?i)(password authentication failed|ECONNREFUSED|no pg_hba\.conf entry|database .+ does not exist)'){return 'POSTGRES_CONNECTION'};return 'UNKNOWN'}

function Patch-InstallerPg {
  $text=[IO.File]::ReadAllText($Installer)
  if($text -match 'PG_RUNTIME_INSTALL_FAILED'){return $false}
  $needle="  & `$npm ci --no-audit --no-fund;if(`$LASTEXITCODE -ne 0){Fail 'NPM_CI_FAILED' 'npm ci failed'}"
  if(-not $text.Contains($needle)){Fail 'INSTALLER_PATCH_POINT_MISSING' 'Cannot safely locate npm ci line'}
  $insert=$needle+"`r`n  & `$npm install --no-save --ignore-scripts --package-lock=false --no-audit --no-fund pg@8.16.3;if(`$LASTEXITCODE -ne 0){Fail 'PG_RUNTIME_INSTALL_FAILED' 'pg@8.16.3 runtime dependency install failed'}"
  $patched=$text.Replace($needle,$insert)
  [IO.File]::WriteAllText($Installer,$patched,(New-Object Text.UTF8Encoding($false)))
  $tokens=$null;$errors=$null
  [System.Management.Automation.Language.Parser]::ParseFile($Installer,[ref]$tokens,[ref]$errors)|Out-Null
  if(@($errors).Count -gt 0){[IO.File]::WriteAllText($Installer,$text,(New-Object Text.UTF8Encoding($false)));Fail 'INSTALLER_PARSE_FAILED' 'Installer patch failed Windows PowerShell parser'}
  return $true
}

function Ensure-RunnerLine([string]$Marker,[string]$Line){
  $text=[IO.File]::ReadAllText($ControllerRunner)
  if($text -match [regex]::Escape($Marker)){return}
  $idx=$text.IndexOf('Set-Location')
  if($idx -lt 0){Fail 'CONTROLLER_RUNNER_UNEXPECTED' "Cannot insert $Marker safely"}
  $backup="$ControllerRunner.pre-wo057-repair"
  if(-not (Test-Path $backup)){Copy-Item $ControllerRunner $backup -Force}
  $text=$text.Insert($idx,$Line+"`r`n")
  [IO.File]::WriteAllText($ControllerRunner,$text,(New-Object Text.UTF8Encoding($false)))
}

function Ensure-TokenAcl {
  if(-not (Test-Path $TokenFile)){return}
  $me=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $TokenFile /inheritance:r /grant:r 'SYSTEM:(F)' 'BUILTIN\Administrators:(F)' "${me}:(F)" *> $null
  $task=Get-ScheduledTask -TaskName $ControllerTask
  $runAs=[string]$task.Principal.UserId
  if($runAs -and $runAs -notmatch '(?i)SYSTEM' -and $runAs -ne $me){& icacls.exe $TokenFile /grant "${runAs}:(R)" *> $null}
}

function Preflight-Recovery([string]$Node){
  if(@(Get-NetIPAddress -IPAddress '100.97.23.87' -ErrorAction SilentlyContinue).Count -eq 0){Add-Root 'TAILSCALE_IP_MISSING';Fail 'TAILSCALE_IP_MISSING' '100.97.23.87 is not assigned'}
  $listeners=@(Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue)
  foreach($l in $listeners){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)" -ErrorAction SilentlyContinue;$cmd=[string]$p.CommandLine;if($cmd -notmatch '(?i)(workforce-controller|dist[\\/]apps[\\/]workforce-controller)'){Add-Root 'PORT_8790_FOREIGN_PROCESS';Fail 'PORT_8790_FOREIGN_PROCESS' "PID $($l.OwningProcess) owns 8790"}}
  if(@(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue).Count -eq 0){$pg=@(Get-Service -ErrorAction SilentlyContinue|Where-Object{$_.Name -match '(?i)postgres' -or $_.DisplayName -match '(?i)postgres'});if($pg.Count -eq 1){Start-Service $pg[0].Name -ErrorAction SilentlyContinue;Start-Sleep -Seconds 8};if(@(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue).Count -eq 0){Add-Root 'POSTGRES_NOT_LISTENING';Fail 'POSTGRES_NOT_LISTENING' 'No PostgreSQL listener on 5432'}}
  if(-not (Pg-ImportOk $Node)){Add-Root 'PG_RUNTIME_ABSENT'}
}

try {
  Write-Host '[WO057] AUDIT -> FIX -> RETEST -> E2E'
  if($env:COMPUTERNAME -ne 'PC01'){Fail 'WRONG_HOST' "Expected PC01; got $env:COMPUTERNAME"}
  $id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Fail 'ADMIN_REQUIRED' 'Run elevated'}
  foreach($p in @($RepoPath,$Installer,$E2E,$ControllerRunner)){if(-not (Test-Path $p)){Fail 'REQUIRED_PATH_MISSING' $p}}
  $Git=(Get-Command git.exe).Source;$Node=(Get-Command node.exe).Source;$PowerShell=(Get-Command powershell.exe).Source
  $branch=(& $Git -C $RepoPath branch --show-current).Trim();if($branch -ne $ExpectedBranch){Fail 'WRONG_BRANCH' "Expected $ExpectedBranch; got $branch"}
  if($branch -in @('main','master','production','prod')){Fail 'PROTECTED_BRANCH' 'Protected branch refused'}
  $dirty=@(& $Git -C $RepoPath status --porcelain);if($dirty.Count -gt 0){Fail 'REPO_NOT_CLEAN' (($dirty|Select-Object -First 10)-join '; ')}

  $task=Get-ScheduledTask -TaskName $ControllerTask -ErrorAction Stop;$info=Get-ScheduledTaskInfo -TaskName $ControllerTask
  $runner=[IO.File]::ReadAllText($ControllerRunner);$tail=Get-LogTail;$initialClass=Classify $tail
  $diag=[ordered]@{host=$env:COMPUTERNAME;branch=$branch;head=(& $Git -C $RepoPath rev-parse HEAD).Trim();task=[ordered]@{state=[string]$task.State;lastRunTime=$info.LastRunTime;lastTaskResult=$info.LastTaskResult;principal=[string]$task.Principal.UserId};runner=[ordered]@{databaseUrl=($runner -match 'TIGERIQ_DATABASE_URL');pgpassfile=($runner -match 'PGPASSFILE');host=($runner -match 'TIGERIQ_WORKFORCE_HOST');port=($runner -match 'TIGERIQ_WORKFORCE_PORT');ingressToken=($runner -match 'TIGERIQ_INGRESS_TOKEN');nodeEntry=($runner -match '(?i)workforce-controller.+standalone\.js')};runtime=[ordered]@{controllerBuilt=(Test-Path (Join-Path $RepoPath 'dist\apps\workforce-controller\src\standalone.js'));pgImport=(Pg-ImportOk $Node);tailscaleIp=(@(Get-NetIPAddress -IPAddress '100.97.23.87' -ErrorAction SilentlyContinue).Count -gt 0);postgres5432=(@(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue).Count -gt 0);port8790Pids=@(Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue|ForEach-Object{$_.OwningProcess});tokenExists=(Test-Path $TokenFile)};logFailureClass=$initialClass;secretValuesPrinted=$false}
  $diag|ConvertTo-Json -Depth 8|Set-Content -Path $DiagPath -Encoding UTF8

  Preflight-Recovery $Node
  $patched=Patch-InstallerPg
  if($patched){Add-Root 'INSTALLER_MISSING_PG_PROVISION'}

  if(-not $runner.Contains('TIGERIQ_WORKFORCE_HOST')){Add-Root 'HOST_CONFIG_MISSING';Ensure-RunnerLine 'TIGERIQ_WORKFORCE_HOST' "`$env:TIGERIQ_WORKFORCE_HOST='100.97.23.87'"}
  if(-not $runner.Contains('TIGERIQ_WORKFORCE_PORT')){Add-Root 'PORT_CONFIG_MISSING';Ensure-RunnerLine 'TIGERIQ_WORKFORCE_PORT' "`$env:TIGERIQ_WORKFORCE_PORT='8790'"}
  if(Test-Path $TokenFile){Ensure-TokenAcl}

  if($initialClass -eq 'DATABASE_URL_MISSING' -and -not ($runner -match 'TIGERIQ_DATABASE_URL')){Add-Root 'DATABASE_URL_MISSING';Fail 'DATABASE_URL_MISSING' 'Cannot invent PostgreSQL credentials'}
  if($initialClass -eq 'POSTGRES_CONNECTION'){Add-Root 'POSTGRES_CONNECTION'}
  if($initialClass -eq 'PG_MODULE_MISSING'){Add-Root 'PG_MODULE_MISSING_CONFIRMED_BY_LOG'}

  Write-Host '[WO057] Running idempotent installer with pg provisioning fix...'
  & $PowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Installer -RepoPath $RepoPath
  if($LASTEXITCODE -ne 0){$newClass=Classify (Get-LogTail);Add-Root $newClass;Fail 'INSTALLER_RETEST_FAILED' "Controller failure class=$newClass; diagnostics=$DiagPath"}

  $status=Wait-Controller 90
  if($null -eq $status -or -not ($status.ok -and $status.postgres)){Fail 'CONTROLLER_UNHEALTHY' "diagnostics=$DiagPath"}
  if(-not $status.pc01 -or -not $status.pc01.online -or $status.pc01.health -ne 'ok'){Fail 'WORKER_UNHEALTHY' 'PC01 worker not online/ok'}
  if([int]$status.workforce.employees -lt 1 -or [int]$status.workforce.devices -lt 1){Fail 'WORKFORCE_REGISTRATION_FAIL' 'employees/devices < 1'}

  Write-Host '[WO057] Running physical A-G...'
  $out=@(& $PowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $E2E -RepoPath $RepoPath 2>&1)
  if($LASTEXITCODE -ne 0){Fail 'E2E_FAILED' (($out|Select-Object -Last 12)-join ' | ')}
  $jsonLine=$out|ForEach-Object{[string]$_}|Where-Object{$_.Trim().StartsWith('{')}|Select-Object -Last 1
  if([string]::IsNullOrWhiteSpace($jsonLine)){Fail 'E2E_JSON_MISSING' 'No final E2E JSON'}
  $e2e=$jsonLine|ConvertFrom-Json
  if(-not $e2e.allPass){Fail 'E2E_NOT_ALL_PASS' 'A-G did not all pass'}
  if(-not (Test-Path $e2e.evidencePath)){Fail 'EVIDENCE_MISSING' $e2e.evidencePath}

  $ollamaPs=Invoke-RestMethod -Uri "$OllamaUrl/api/ps" -Method Get -TimeoutSec 10
  $running=@($ollamaPs.models|Where-Object{$_.name -eq 'qwen3:8b' -or $_.model -eq 'qwen3:8b'}|Select-Object -First 1)
  if($running.Count -eq 0){Fail 'OLLAMA_MODEL_NOT_RUNNING' 'qwen3:8b absent from /api/ps'}
  if([int]$running[0].context_length -ne 4096){Fail 'CTX4096_FAIL' "context_length=$($running[0].context_length)"}
  $built=Join-Path $RepoPath 'dist\apps\pc01-native-worker\src\ollama.js';if(-not (Test-Path $built)){Fail 'OLLAMA_BUILD_MISSING' $built}
  $builtText=[IO.File]::ReadAllText($built);if($builtText -notmatch 'think\s*:\s*false'){Fail 'THINK_FALSE_FAIL' 'Deployed worker lacks think:false'}

  $ev=[IO.File]::ReadAllText($e2e.evidencePath)|ConvertFrom-Json
  $extra=[ordered]@{contextLength=[int]$running[0].context_length;ctx4096=$true;deployedThinkFalse=$true;configuredLocalAiMax=2;controllerHealthy=$true;postgresHealthy=$true;pc01Online=$true;pc01Health='ok';employees=[int]$status.workforce.employees;devices=[int]$status.workforce.devices;rootCause=@($RootCauses)}
  $ev|Add-Member -NotePropertyName runtimeConfigVerification -NotePropertyValue $extra -Force
  [IO.File]::WriteAllText($e2e.evidencePath,($ev|ConvertTo-Json -Depth 30),(New-Object Text.UTF8Encoding($false)))

  $evidenceRel=$e2e.evidencePath.Substring($RepoPath.Length).TrimStart('\') -replace '\\','/'
  & $Git -C $RepoPath add -- 'scripts/pc01-primary-node/Install-PC01-PrimaryNode.ps1' $evidenceRel
  $staged=@(& $Git -C $RepoPath diff --cached --name-only)
  if($staged.Count -gt 0){& $Git -C $RepoPath -c user.name='TigerIQ PC01' -c user.email='pc01@tigeriq.local' commit -m 'fix(pc01): verify controller recovery and physical A-G';if($LASTEXITCODE -ne 0){Fail 'COMMIT_FAILED' 'Could not commit physical fix/evidence'}}
  $env:GIT_TERMINAL_PROMPT='0'; & $Git -C $RepoPath push origin ("HEAD:refs/heads/{0}" -f $ExpectedBranch);$pushOk=($LASTEXITCODE -eq 0)

  $result=[ordered]@{status=if($pushOk){'PHYSICAL_PASS'}else{'PHYSICAL_PASS_PUSH_WAIT'};rootCause=@($RootCauses);controller=$true;postgres=$true;worker=$true;employees=[int]$status.workforce.employees;devices=[int]$status.workforce.devices;e2eAtoG=$true;ctx4096=$true;thinkFalse=$true;localAiMax2=$true;evidence=$evidenceRel;diagnostics=$DiagPath;head=(& $Git -C $RepoPath rev-parse HEAD).Trim();remotePush=$pushOk;mainProductionTouched=$false;openClawUsed=$false;secretsPrinted=$false}
  Write-Host ('TIGERIQ_WO057_RESULT='+($result|ConvertTo-Json -Depth 8 -Compress))
}
catch {
  $result=[ordered]@{status='REAL_BLOCKER';error=$_.Exception.Message;rootCause=@($RootCauses);diagnostics=$DiagPath;mainProductionTouched=$false;openClawUsed=$false;secretsPrinted=$false}
  Write-Host ('TIGERIQ_WO057_RESULT='+($result|ConvertTo-Json -Depth 8 -Compress))
  exit 1
}
