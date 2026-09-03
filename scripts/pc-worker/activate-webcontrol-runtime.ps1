param(
  [string]$Branch = 'wo196/pc01-command-center-ui-v2',
  [Parameter(Mandatory=$true)][string]$Commit,
  [Parameter(Mandatory=$true)][string]$CommandHost,
  [int]$ControllerPort = 8790,
  [string]$ThirdModel = 'gemma3:4b'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'newsdayads/tigeriq-ai-lab'
$controllerTask = 'TigerIQ Workforce Controller'
$controllerFirewall = 'TigerIQ Workforce Controller (Tailscale)'
$runtimeRoot = 'F:\TigerIQ\WorkforceController'
$releaseRoot = Join-Path $runtimeRoot 'releases'
$runner = Join-Path $runtimeRoot 'run-workforce-controller.ps1'
$log = Join-Path $runtimeRoot 'workforce-controller.log'
$statePath = 'F:\TigerIQ\State\workforce.jsonl'
$secretPath = 'F:\TigerIQ\Secrets\workforce-admin.secret'

function Fail([string]$Code,[string]$Message){ Write-Error "$Code`: $Message"; exit 1 }
function Is-TailscaleIPv4([string]$Address){
  if($Address -notmatch '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$'){ return $false }
  $p = $Address.Split('.') | ForEach-Object { [int]$_ }
  return $p[1] -ge 64 -and $p[1] -le 127 -and @($p | Where-Object { $_ -lt 0 -or $_ -gt 255 }).Count -eq 0
}
function Read-OllamaModels {
  try {
    $tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
  } catch { Fail 'OLLAMA_UNREACHABLE' $_.Exception.Message }
  return @($tags.models)
}
function Ensure-Secret {
  New-Item -ItemType Directory -Force -Path (Split-Path $secretPath -Parent) | Out-Null
  if(-not(Test-Path -LiteralPath $secretPath)){
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $value = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    [IO.File]::WriteAllText($secretPath,$value,(New-Object Text.UTF8Encoding($false)))
  }
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -Path $secretPath -AclObject $acl
}

Write-Host '[5%] RUNTIME PRECHECK' -ForegroundColor Cyan
$id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($id)
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){ Fail 'ADMIN_REQUIRED' 'Administrator permission is required.' }
if($Commit -notmatch '^[0-9a-fA-F]{40}$'){ Fail 'INVALID_COMMIT' $Commit }
if(-not(Is-TailscaleIPv4 $CommandHost)){ Fail 'UNSAFE_COMMAND_HOST' $CommandHost }
if($ControllerPort -lt 1024 -or $ControllerPort -gt 65535){ Fail 'INVALID_CONTROLLER_PORT' $ControllerPort }
$git=(Get-Command git.exe -ErrorAction Stop).Source
$gh=(Get-Command gh.exe -ErrorAction Stop).Source
$node=(Get-Command node.exe -ErrorAction Stop).Source
$npm=(Get-Command npm.cmd -ErrorAction Stop).Source
$ollama=(Get-Command ollama.exe -ErrorAction SilentlyContinue)
if(-not $ollama){ $candidate='C:\Users\'+$env:USERNAME+'\AppData\Local\Programs\Ollama\ollama.exe'; if(Test-Path $candidate){ $ollama=Get-Item $candidate } }
if(-not $ollama){ Fail 'OLLAMA_CLI_MISSING' 'ollama.exe was not found.' }
$powershell=(Get-Command powershell.exe -ErrorAction Stop).Source
$null=& $gh auth status;if($LASTEXITCODE -ne 0){ Fail 'GH_AUTH_MISSING' 'GitHub CLI is not authenticated.' }

Write-Host '[12%] EXACT SHA + CI GATE' -ForegroundColor Cyan
$encoded=[uri]::EscapeDataString($Branch)
$head=(& $gh api "repos/$repo/commits/$encoded" --jq .sha 2>$null | Out-String).Trim()
if($LASTEXITCODE -ne 0 -or $head -ne $Commit){ Fail 'BRANCH_HEAD_MISMATCH' "Expected $Commit; got $head" }
$runsRaw=(& $gh api "repos/$repo/actions/runs?head_sha=$Commit&status=completed&per_page=30" 2>$null | Out-String)
if($LASTEXITCODE -ne 0 -or -not $runsRaw){ Fail 'CI_STATUS_UNAVAILABLE' 'Could not read CI status.' }
$runs=$runsRaw|ConvertFrom-Json;$ci=@($runs.workflow_runs|Where-Object{$_.name -eq 'CI' -and $_.conclusion -eq 'success'})|Select-Object -First 1
if(-not $ci){ Fail 'CI_NOT_PASS' "Exact SHA $Commit has no successful CI run." }

Write-Host '[20%] THREE-MODEL INDEPENDENCE GATE' -ForegroundColor Cyan
$models=Read-OllamaModels
if(-not @($models | Where-Object { $_.name -eq $ThirdModel }).Count){
  Write-Host "Pulling third independent local model: $ThirdModel" -ForegroundColor Yellow
  & $ollama.Source pull $ThirdModel
  if($LASTEXITCODE -ne 0){ Fail 'OLLAMA_PULL_FAILED' $ThirdModel }
  $models=Read-OllamaModels
}
$digests=@($models | ForEach-Object { [string]$_.digest } | Where-Object { $_ -match '^[0-9a-f]{32,}$' } | Select-Object -Unique)
if($digests.Count -lt 3){ Fail 'THREE_MODEL_DIGEST_GATE_NOT_MET' "Need >=3 distinct immutable Ollama digests; found $($digests.Count)." }
Write-Host "Model gate PASS: $($digests.Count) distinct digests." -ForegroundColor Green

Write-Host '[35%] ISOLATED WORKFORCE CONTROLLER RELEASE' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $releaseRoot,$runtimeRoot,(Split-Path $statePath -Parent) | Out-Null
$stamp=(Get-Date).ToString('yyyyMMdd-HHmmss');$short=$Commit.Substring(0,12);$releaseDir=Join-Path $releaseRoot "$short-$stamp"
& $git clone --no-checkout "https://github.com/$repo.git" $releaseDir
if($LASTEXITCODE -ne 0){ Fail 'CONTROLLER_CLONE_FAILED' $releaseDir }
& $git config --global --add safe.directory ($releaseDir -replace '\\','/')
if($LASTEXITCODE -ne 0){ Fail 'SAFE_DIRECTORY_FAILED' $releaseDir }
& $git -C $releaseDir fetch origin $Branch --prune
if($LASTEXITCODE -ne 0){ Fail 'CONTROLLER_FETCH_FAILED' $Branch }
$fetched=(& $git -C $releaseDir rev-parse "origin/$Branch").Trim();if($fetched -ne $Commit){ Fail 'FETCHED_HEAD_MISMATCH' "Expected $Commit; got $fetched" }
& $git -C $releaseDir checkout --detach $Commit
if($LASTEXITCODE -ne 0){ Fail 'CONTROLLER_CHECKOUT_FAILED' $Commit }
Push-Location $releaseDir
try {
  & $npm ci --no-audit --no-fund
  if($LASTEXITCODE -ne 0){ Fail 'CONTROLLER_NPM_CI_FAILED' 'npm ci failed.' }
  & $npm run build
  if($LASTEXITCODE -ne 0){ Fail 'CONTROLLER_BUILD_FAILED' 'npm run build failed.' }
} finally { Pop-Location }
$entry=Join-Path $releaseDir 'dist\apps\workforce-controller\src\standalone.js'
if(-not(Test-Path -LiteralPath $entry)){ Fail 'CONTROLLER_ARTIFACT_MISSING' $entry }
Ensure-Secret

Write-Host '[65%] PRIVATE CONTROLLER SWITCH' -ForegroundColor Cyan
Stop-ScheduledTask -TaskName $controllerTask -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$listener=Get-NetTCPConnection -LocalAddress $CommandHost -LocalPort $ControllerPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if($listener){
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if(-not $proc -or ($proc.CommandLine -notlike '*workforce-controller*' -and $proc.CommandLine -notlike '*run-workforce-controller.ps1*')){
    Fail 'CONTROLLER_PORT_OWNED_BY_UNKNOWN_PROCESS' "PID $($listener.OwningProcess) owns $CommandHost`:$ControllerPort"
  }
  Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
  Start-Sleep -Seconds 1
}
Unregister-ScheduledTask -TaskName $controllerTask -Confirm:$false -ErrorAction SilentlyContinue
$repoEsc=$releaseDir.Replace("'","''");$stateEsc=$statePath.Replace("'","''");$hostEsc=$CommandHost.Replace("'","''");$secretEsc=$secretPath.Replace("'","''");$nodeEsc=$node.Replace("'","''");$logEsc=$log.Replace("'","''")
$runnerText=@"
`$ErrorActionPreference='Stop'
Set-Location '$repoEsc'
`$env:TIGERIQ_WORKFORCE_JOURNAL='$stateEsc'
`$env:TIGERIQ_WORKFORCE_HOST='$hostEsc'
`$env:TIGERIQ_WORKFORCE_PORT='$ControllerPort'
`$env:TIGERIQ_WORKFORCE_ALLOW_TAILNET_SELF_PAIR='1'
`$env:TIGERIQ_WORKFORCE_ADMIN_SECRET=[IO.File]::ReadAllText('$secretEsc').Trim()
& '$nodeEsc' 'dist/apps/workforce-controller/src/standalone.js' *>> '$logEsc'
exit `$LASTEXITCODE
"@
$tmp="$runner.new";[IO.File]::WriteAllText($tmp,$runnerText,(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $runner
$action=New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`""
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$taskPrincipal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $controllerTask -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal|Out-Null
$old=Get-NetFirewallRule -DisplayName $controllerFirewall -ErrorAction SilentlyContinue;if($old){Remove-NetFirewallRule -DisplayName $controllerFirewall}
New-NetFirewallRule -DisplayName $controllerFirewall -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $CommandHost -LocalPort $ControllerPort -RemoteAddress '100.64.0.0/10' -Profile Any | Out-Null
Start-ScheduledTask -TaskName $controllerTask

Write-Host '[82%] CONTROLLER + WEBCONTROL VERIFY' -ForegroundColor Cyan
$deadline=(Get-Date).AddSeconds(60);$wf=$null
do { Start-Sleep -Seconds 2; try{$wf=Invoke-RestMethod -Uri "http://$CommandHost`:$ControllerPort/api/workforce/status" -TimeoutSec 5}catch{$wf=$null}; if($wf -and $wf.ok){break} } while((Get-Date)-lt $deadline)
if(-not $wf -or -not $wf.ok){
  $tail=if(Test-Path $log){(Get-Content $log -Tail 20)-join ' | '}else{'no log'}
  Fail 'WORKFORCE_STATUS_NOT_HEALTHY' $tail
}
$web=$null
try { $web=Invoke-RestMethod -Uri "http://$CommandHost`:8787/api/server" -TimeoutSec 10 } catch { Fail 'WEBCONTROL_API_UNAVAILABLE' $_.Exception.Message }
if(-not $web.controller -or -not $web.controller.online){ Fail 'WEBCONTROL_CONTROLLER_NOT_ONLINE' 'Command Center telemetry still reports Controller offline.' }
$task=Get-ScheduledTask -TaskName $controllerTask -ErrorAction Stop
if($task.State -ne 'Running'){ Fail 'CONTROLLER_TASK_NOT_RUNNING' $task.State.ToString() }

Write-Host '[100%] TIGERIQ RUNTIME ACTIVATION PASS' -ForegroundColor Green
[ordered]@{
  status='PASS'; commit=$Commit; ciRunId=$ci.id; controller="http://$CommandHost`:$ControllerPort/api/workforce/status";
  controllerTask=$task.State.ToString(); distinctModelDigests=$digests.Count; thirdModel=$ThirdModel;
  webControlControllerOnline=$web.controller.online; workforceEmployees=if($wf.workforce){$wf.workforce.employees.total}else{0};
  statePreserved=$statePath; secret='STORED_LOCALLY_REDACTED'; mainProductionTouched=$false
}|ConvertTo-Json -Depth 6 -Compress
