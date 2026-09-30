param([int]$IntervalSeconds=120)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$controlRepo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$runtimeRepo='D:\TigerIQ\Runtime\CoreSource'
$runtimeSourceState='D:\TigerIQ\State\core-runtime-source.json'
$updaterRuntime='D:\TigerIQ\Runtime\CoreUpdater\update-core-runtime.ps1'
$launcherRuntime='D:\TigerIQ\Runtime\CoreLaunchers'
$state='D:\TigerIQ\State\core-runtime-updater.json'
$openclawState='D:\TigerIQ\State\openclaw-runtime-applied.json'
$openclawCanaryState='D:\TigerIQ\State\openclaw-runtime-canary.json'
$openclawCanaryScript=(Join-Path $runtimeRepo 'apps\openclaw-tigeriq-runtime\canary.mjs')
$openclawCanaryIssue=1430
$openclawCanaryPolicyGeneration='20260922_DETERMINISTIC_CANARY_2'
$openclawGatewayStartupTimeoutSec=120
$appChromeIssue=1372
$appChromeController='http://127.0.0.1:8798'
$appChromeTask='TigerIQ APP Chrome Unified'
$appChromeTaskBlueprint='D:\TigerIQ\State\app-chrome-unified-task.xml'
$appChromeTaskBlueprintHash='D:\TigerIQ\State\app-chrome-unified-task.sha256'
$appChromeResumeState='D:\TigerIQ\State\app-chrome-runtime-recovery.json'
$appChromeZeroTouchScript=(Join-Path $runtimeRepo 'scripts\tigeriq-core\appchrome-zero-touch.ps1')
$liveStatusBridgeTask='TigerIQ Live Status Bridge'
$liveStatusBridgeDir='D:\TigerIQ\Runtime\LiveStatusBridge'
$liveStatusBridgeSource=(Join-Path $runtimeRepo 'apps\tigeriq-live-bridge\server.mjs')
$liveStatusBridgeRuntime=(Join-Path $liveStatusBridgeDir 'server.mjs')
$liveStatusBridgeState=(Join-Path $liveStatusBridgeDir 'state.json')
$coreTask='TigerIQ Core 24x7'
$webTask='TigerIQ Web Control 24x7'
$codingTask='TigerIQ Coding Lane 24x7'
$openclawTask='TigerIQ OpenClaw Gateway'
$remoteDesktopTask='TigerIQ Desktop Commander Remote'
$remoteDesktopRuntime='D:\TigerIQ\Runtime\desktop-commander-remote'
$remoteDesktopLifecycleGeneration='20260930_TOPOLOGY_2'
$remoteDesktopLifecycleState='D:\TigerIQ\State\rdc-lifecycle-generation.txt'
$remoteDesktopGuardInstaller=(Join-Path $runtimeRepo 'apps\remote-desktop-guard\install-runtime.mjs')
$updaterTask='TigerIQ Core Runtime Updater'
$legacyAutonomySupervisorTask='TigerIQ Autonomy Supervisor V2'
$bootstrapWatchdogTask='TigerIQ Bootstrap Watchdog'
$bootstrapWatchdogRuntime='D:\TigerIQ\Runtime\BootstrapWatchdog\bootstrap-watchdog.ps1'
$webRuntime='D:\TigerIQ\Runtime\WebControl24x7'
$tokenPath='D:\TigerIQ\Secrets\github-command-center.token'
$corePath=(Join-Path $runtimeRepo 'apps\tigeriq-core\core-entry.mjs').ToLowerInvariant()
$legacyCorePath=(Join-Path $controlRepo 'apps\tigeriq-core\core-entry.mjs').ToLowerInvariant()
$codingPath=(Join-Path $runtimeRepo 'apps\tigeriq-coding-lane\coding-entry.mjs').ToLowerInvariant()
$legacyCodingPath=(Join-Path $controlRepo 'apps\tigeriq-coding-lane\coding-entry.mjs').ToLowerInvariant()
$webPath=(Join-Path $webRuntime 'web-control-server.mjs').ToLowerInvariant()
$mutex=New-Object Threading.Mutex($false,'Global\TigerIQCoreRuntimeUpdaterV2')
$healthFailures=@{core=0;web=0;coding=0;openclaw=0;appchrome=0}
$lastHeal=@{core=[DateTime]::MinValue;web=[DateTime]::MinValue;coding=[DateTime]::MinValue;openclaw=[DateTime]::MinValue;appchrome=[DateTime]::MinValue}
$healCooldownSec=300
$watchdog=$null
$githubApiBackoffUntil=[DateTime]::MinValue
$githubApiBackoffState='D:\TigerIQ\State\github-api-rate-limit-backoff.json'
$appChromeInstallPollIntervalSec=120
$appChromeResumePollIntervalSec=900
$lastAppChromeInstallPoll=[DateTime]::MinValue
$lastAppChromeResumePoll=[DateTime]::MinValue
function Save-State([hashtable]$d){$d.updatedAt=(Get-Date).ToUniversalTime().ToString('o');$tmp="$state.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $state}
function Head([string]$repoPath,[string]$ref){(& git -C $repoPath rev-parse $ref 2>$null|Out-String).Trim()}
function Save-RuntimeSourceState([string]$currentSha,[string]$previousSha,[string]$gateSha){
  $d=[ordered]@{schema='TIGERIQ_RUNTIME_SOURCE_V1';sourcePath=$runtimeRepo;currentSha=$currentSha;previousSha=$previousSha;gateSha=$gateSha;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp="$runtimeSourceState.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $runtimeSourceState
}
function Runtime-Source-Dirty(){
  if(-not(Test-Path -LiteralPath $runtimeRepo)){return $false}
  $inside=(& git -C $runtimeRepo rev-parse --is-inside-work-tree 2>$null|Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or $inside -ne 'true'){throw 'RUNTIME_SOURCE_INVALID'}
  return [bool](@(git -C $runtimeRepo status --porcelain).Count)
}
function Ensure-NodeModules(){param([string]$repoPath)
  $modulesPath=Join-Path $repoPath 'node_modules'
  $packageLock=Join-Path $repoPath 'package-lock.json'
  $packageJson=Join-Path $repoPath 'package.json'
  $valid=$true
  if(-not(Test-Path -LiteralPath $modulesPath)){$valid=$false}
  elseif((Test-Path -LiteralPath $packageLock) -and (Test-Path -LiteralPath $packageJson)){
    $lockTime=(Get-Item -LiteralPath $packageLock).LastWriteTimeUtc
    $jsonTime=(Get-Item -LiteralPath $packageJson).LastWriteTimeUtc
    $modTime=(Get-Item -LiteralPath $modulesPath).LastWriteTimeUtc
    if($lockTime -gt $modTime -or $jsonTime -gt $modTime){$valid=$false}
  }
  if(-not $valid){
    if(-not(Test-Path -LiteralPath $packageLock)){throw 'PACKAGE_LOCK_MISSING'}
    & npm --prefix $repoPath ci --ignore-scripts --no-audit --no-fund
    if($LASTEXITCODE -ne 0){throw 'NPM_CI_FAILED'}
  }
}
function Ensure-RuntimeSource([string]$targetSha){
  if(Test-Path -LiteralPath $runtimeRepo){
    if(Runtime-Source-Dirty){throw 'RUNTIME_SOURCE_DIRTY'}
    git -C $runtimeRepo reset --hard $targetSha|Out-Null
    if($LASTEXITCODE -ne 0){throw 'RUNTIME_SOURCE_RESET_FAILED'}
    return
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeRepo) -Force|Out-Null
  git -C $controlRepo worktree add --detach $runtimeRepo $targetSha|Out-Null
  if($LASTEXITCODE -ne 0){throw 'RUNTIME_SOURCE_CREATE_FAILED'}
}
function Sync-Launchers(){
  New-Item -ItemType Directory -Path $launcherRuntime -Force|Out-Null
  foreach($name in @('run-core.ps1','run-coding-lane.ps1')){
    $source=Join-Path $runtimeRepo ('scripts\tigeriq-core\'+$name);if(-not(Test-Path -LiteralPath $source)){throw ('LAUNCHER_SOURCE_MISSING:'+ $name)}
    $target=Join-Path $launcherRuntime $name;$tmp=$target+'.tmp';Copy-Item -LiteralPath $source -Destination $tmp -Force;Move-Item -LiteralPath $tmp -Destination $target -Force
  }
}
function Sync-UpdaterRuntime(){
  $source=Join-Path $runtimeRepo 'scripts\tigeriq-core\update-core-runtime.ps1';if(-not(Test-Path -LiteralPath $source)){throw 'UPDATER_SOURCE_MISSING'}
  New-Item -ItemType Directory -Path (Split-Path -Parent $updaterRuntime) -Force|Out-Null
  $tmp=$updaterRuntime+'.tmp';Copy-Item -LiteralPath $source -Destination $tmp -Force;Move-Item -LiteralPath $tmp -Destination $updaterRuntime -Force
}
function Ensure-UpdaterTaskRuntimeTarget(){
  # TIGERIQ_UPDATER_TASK_SELF_HEAL_V1: the updater must be able to recreate its own AtStartup task
  # when launched manually/native after a reboot. Bootstrap Watchdog provides the outer recovery path.
  $expectedExe='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $expectedArgs="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$updaterRuntime`" -IntervalSeconds $IntervalSeconds"
  $newAction=New-ScheduledTaskAction -Execute $expectedExe -Argument $expectedArgs
  $newSettings=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew
  $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $task=Get-ScheduledTask -TaskName $updaterTask -ErrorAction SilentlyContinue
  if(-not $task){
    if(-not(Test-Path -LiteralPath $updaterRuntime)){return @{action='blocked';reason='UPDATER_RUNTIME_MISSING';target=$updaterRuntime}}
    $trigger=New-ScheduledTaskTrigger -AtStartup
    Register-ScheduledTask -TaskName $updaterTask -Action $newAction -Trigger $trigger -Settings $newSettings -Principal $principal -Force|Out-Null
    return @{action='installed';target=$updaterRuntime;multipleInstances='IgnoreNew';runAs='SYSTEM';trigger='AtStartup'}
  }
  $action=@($task.Actions|Select-Object -First 1)
  $currentExe=[string]$action.Execute
  $currentArgs=[string]$action.Arguments
  $multiple=[string]$task.Settings.MultipleInstances
  $actionOk=($currentExe -ieq $expectedExe -and $currentArgs -match [regex]::Escape($updaterRuntime))
  $settingsOk=($multiple -eq 'IgnoreNew')
  if($actionOk -and $settingsOk){return @{action='none';target=$updaterRuntime;multipleInstances=$multiple}}
  Set-ScheduledTask -TaskName $updaterTask -Action $newAction -Settings $newSettings -Principal $principal|Out-Null
  return @{action='retargeted';target=$updaterRuntime;previousExecute=$currentExe;previousArguments=$currentArgs;previousMultipleInstances=$multiple;multipleInstances='IgnoreNew'}
}
function Ensure-WebTaskRuntimeTarget(){
  try{
    $launcher=Join-Path $webRuntime 'run-web-control-bundle.ps1'
    if(-not(Test-Path -LiteralPath $launcher)){return @{action='blocked';reason='WEB_LAUNCHER_MISSING';target=$launcher}}
    $ps='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $args="-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
    $action=New-ScheduledTaskAction -Execute $ps -Argument $args
    $settings=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $task=Get-ScheduledTask -TaskName $webTask -ErrorAction SilentlyContinue
    if(-not $task){
      $trigger=New-ScheduledTaskTrigger -AtStartup
      Register-ScheduledTask -TaskName $webTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force|Out-Null
      Start-ScheduledTask -TaskName $webTask
      return @{action='installed_started';task=$webTask;target=$launcher}
    }
    $first=@($task.Actions|Select-Object -First 1)
    $currentExe=[string]$first.Execute
    $currentArgs=[string]$first.Arguments
    $multiple=[string]$task.Settings.MultipleInstances
    $actionOk=($currentExe -ieq $ps -and $currentArgs -match [regex]::Escape($launcher))
    $settingsOk=($multiple -eq 'IgnoreNew' -and [bool]$task.Settings.StartWhenAvailable -and -not [bool]$task.Settings.DisallowStartIfOnBatteries -and -not [bool]$task.Settings.StopIfGoingOnBatteries)
    $retarget=(-not $actionOk -or -not $settingsOk)
    if($retarget){Set-ScheduledTask -TaskName $webTask -Action $action -Settings $settings -Principal $principal|Out-Null}
    $fresh=Get-ScheduledTask -TaskName $webTask -ErrorAction SilentlyContinue
    if($fresh -and [string]$fresh.State -ne 'Running'){Start-ScheduledTask -TaskName $webTask}
    return @{action=if($retarget){'retargeted_started'}else{'verified_started'};task=$webTask;target=$launcher}
  }catch{return @{action='blocked';reason=('WEB_TASK_'+$_.Exception.GetType().Name);detail=[string]$_.Exception.Message}}
}
function Ensure-BootstrapWatchdogTask(){
  try{
    $source=Join-Path $runtimeRepo 'scripts\tigeriq-core\bootstrap-watchdog.ps1'
    if(-not(Test-Path -LiteralPath $source)){return @{action='skip';reason='SOURCE_MISSING'}}
    New-Item -ItemType Directory -Path (Split-Path -Parent $bootstrapWatchdogRuntime) -Force|Out-Null
    $needsCopy=$true
    if(Test-Path -LiteralPath $bootstrapWatchdogRuntime){
      try{$needsCopy=((Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $bootstrapWatchdogRuntime).Hash)}catch{$needsCopy=$true}
    }
    if($needsCopy){$tmp=$bootstrapWatchdogRuntime+'.tmp';Copy-Item -LiteralPath $source -Destination $tmp -Force;Move-Item -LiteralPath $tmp -Destination $bootstrapWatchdogRuntime -Force}
    $task=Get-ScheduledTask -TaskName $bootstrapWatchdogTask -ErrorAction SilentlyContinue
    $ps='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $args="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$bootstrapWatchdogRuntime`" -IntervalSeconds 60 -FailureThreshold 2 -CooldownSeconds 300"
    $action=New-ScheduledTaskAction -Execute $ps -Argument $args
    $settings=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
    $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    if(-not $task){
      $trigger=New-ScheduledTaskTrigger -AtStartup
      Register-ScheduledTask -TaskName $bootstrapWatchdogTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force|Out-Null
      Start-ScheduledTask -TaskName $bootstrapWatchdogTask
      return @{action='installed';task=$bootstrapWatchdogTask}
    }
    $first=@($task.Actions|Select-Object -First 1)
    $retarget=([string]$first.Execute -ine $ps -or [string]$first.Arguments -notmatch [regex]::Escape($bootstrapWatchdogRuntime))
    if($retarget){Set-ScheduledTask -TaskName $bootstrapWatchdogTask -Action $action -Settings $settings -Principal $principal|Out-Null}
    $fresh=Get-ScheduledTask -TaskName $bootstrapWatchdogTask -ErrorAction SilentlyContinue
    $mustRestart=[bool]($retarget -or $needsCopy)
    if($fresh -and $mustRestart -and [string]$fresh.State -eq 'Running'){
      Stop-ScheduledTask -TaskName $bootstrapWatchdogTask -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 750
      Start-ScheduledTask -TaskName $bootstrapWatchdogTask -ErrorAction Stop
    }elseif($fresh -and [string]$fresh.State -ne 'Running'){
      Start-ScheduledTask -TaskName $bootstrapWatchdogTask -ErrorAction Stop
    }
    return @{action=if($mustRestart){'refreshed_restarted'}else{'verified'};task=$bootstrapWatchdogTask}
  }catch{return @{action='blocked';reason=('BOOTSTRAP_WATCHDOG_'+$_.Exception.GetType().Name)}}
}
function Test-AppChromeTaskContract($task){
  if(-not $task){return $false}
  $first=@($task.Actions|Select-Object -First 1)
  if(-not $first){return $false}
  $execute=[string]$first.Execute
  $arguments=[string]$first.Arguments
  $allowed=@(
    'D:\TigerIQ\Apps\ChromeController\Runtime\Start-Unified-AppChrome.ps1',
    'D:\TigerIQ\Apps\ChromeController\Runtime\Start-Unified-AppChrome-1372.ps1'
  )
  $launcherOk=[bool](@($allowed|Where-Object{$arguments -match [regex]::Escape($_)}).Count)
  $powershellOk=([IO.Path]::GetFileName($execute) -match '^(powershell|pwsh)\.exe$')
  return ($launcherOk -and $powershellOk)
}
function Sync-AppChromeTaskBlueprint(){
  try{
    $task=Get-ScheduledTask -TaskName $appChromeTask -ErrorAction SilentlyContinue
    if(-not $task){return @{action='blocked';reason='APPCHROME_TASK_MISSING';task=$appChromeTask}}
    if(-not(Test-AppChromeTaskContract $task)){return @{action='blocked';reason='APPCHROME_TASK_CONTRACT_INVALID';task=$appChromeTask}}
    $xml=Export-ScheduledTask -TaskName $appChromeTask -ErrorAction Stop
    if([string]::IsNullOrWhiteSpace([string]$xml)){return @{action='blocked';reason='APPCHROME_TASK_EXPORT_EMPTY';task=$appChromeTask}}
    $dir=Split-Path -Parent $appChromeTaskBlueprint
    if(-not(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
    $tmp=$appChromeTaskBlueprint+'.tmp'
    [IO.File]::WriteAllText($tmp,[string]$xml,[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tmp -Destination $appChromeTaskBlueprint -Force
    $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $appChromeTaskBlueprint).Hash.ToLowerInvariant()
    $hashTmp=$appChromeTaskBlueprintHash+'.tmp'
    [IO.File]::WriteAllText($hashTmp,$hash,[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $hashTmp -Destination $appChromeTaskBlueprintHash -Force
    return @{action='synced';reason='APPCHROME_TASK_BLUEPRINT_CURRENT';task=$appChromeTask;sha256=$hash}
  }catch{return @{action='blocked';reason=('APPCHROME_TASK_BLUEPRINT_'+$_.Exception.GetType().Name);task=$appChromeTask}}
}
function Retire-LegacyOpenClawLifecycleOwner(){
  $task=Get-ScheduledTask -TaskName $legacyAutonomySupervisorTask -ErrorAction SilentlyContinue
  if(-not $task){return @{action='none';reason='legacy_task_absent'}}
  try{
    if([string]$task.State -eq 'Running'){Stop-ScheduledTask -TaskName $legacyAutonomySupervisorTask -ErrorAction SilentlyContinue}
    Disable-ScheduledTask -TaskName $legacyAutonomySupervisorTask -ErrorAction Stop|Out-Null
    return @{action='disabled';task=$legacyAutonomySupervisorTask;reason='superseded_openclaw_lifecycle_owner'}
  }catch{
    return @{action='blocked';task=$legacyAutonomySupervisorTask;reason=('legacy_retire_'+$_.Exception.GetType().Name)}
  }
}
function HealthInfo([string]$url){try{$r=Invoke-RestMethod -Uri $url -TimeoutSec 5;if($r.ok){return $r}}catch{};return $null}
function Load-GithubApiBackoff(){
  $script:githubApiBackoffUntil=[DateTime]::MinValue
  try{
    if(-not(Test-Path -LiteralPath $githubApiBackoffState)){return}
    $saved=Get-Content -LiteralPath $githubApiBackoffState -Raw|ConvertFrom-Json -ErrorAction Stop
    $until=[DateTime]::Parse([string]$saved.untilUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    if($until -gt (Get-Date).ToUniversalTime()){$script:githubApiBackoffUntil=$until}
  }catch{$script:githubApiBackoffUntil=[DateTime]::MinValue}
}
function Save-GithubApiBackoff([DateTime]$until,[string]$reason){
  $script:githubApiBackoffUntil=$until.ToUniversalTime()
  $d=[ordered]@{schema='TIGERIQ_GITHUB_API_BACKOFF_V1';untilUtc=$script:githubApiBackoffUntil.ToString('o');reason=$reason;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp="$githubApiBackoffState.tmp"
  [IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
  Move-Item -Force $tmp $githubApiBackoffState
}
function Test-GithubApiBackoff(){
  $now=(Get-Date).ToUniversalTime()
  if($script:githubApiBackoffUntil -le $now){Load-GithubApiBackoff}
  return ($now -lt $script:githubApiBackoffUntil)
}
function Set-GithubApiBackoffFromText([string]$raw){
  if([string]::IsNullOrWhiteSpace($raw)){return $false}
  if($raw -notmatch '(?i)(API rate limit exceeded|rate limit exceeded)'){return $false}
  Save-GithubApiBackoff ((Get-Date).ToUniversalTime().AddMinutes(15)) 'rate_limit_text'
  return $true
}
function Invoke-GithubApiJson([string]$endpoint,[string[]]$headers=@()){
  if(Test-GithubApiBackoff){throw 'GITHUB_API_RATE_LIMIT_BACKOFF'}
  $args=@('api')
  foreach($header in @($headers)){if($header){$args+=@('-H',$header)}}
  $args+=$endpoint
  $raw=(& gh @args 2>&1|Out-String)
  if($LASTEXITCODE -ne 0){
    if(Set-GithubApiBackoffFromText $raw){throw 'GITHUB_API_RATE_LIMIT'}
    $detail=([string]$raw).Trim()
    if($detail.Length -gt 300){$detail=$detail.Substring(0,300)}
    throw ('GITHUB_API_FAILED:'+ $detail)
  }
  return ($raw|ConvertFrom-Json -ErrorAction Stop)
}
function Owner-AppChromeResumeRequested(){
  $now=(Get-Date).ToUniversalTime()
  if(Test-GithubApiBackoff){return $false}
  if((($now-$script:lastAppChromeResumePoll).TotalSeconds) -lt $appChromeResumePollIntervalSec){return $false}
  $script:lastAppChromeResumePoll=$now
  try{
    $raw=(& gh issue view $appChromeIssue --repo newsdayads/tigeriq-ai-lab --json body --jq '.body' 2>&1|Out-String)
    if($LASTEXITCODE -ne 0){$null=Set-GithubApiBackoffFromText $raw;return $false}
    $lines=@($raw -split [Environment]::NewLine|ForEach-Object{$_.Trim()})
    return [bool]($lines -contains 'OWNER_RUNTIME_RESUME=true')
  }catch{return $false}
}
function Get-AppChromeResumeState(){
  try{if(Test-Path -LiteralPath $appChromeResumeState){return (Get-Content -LiteralPath $appChromeResumeState -Raw|ConvertFrom-Json)}}catch{}
  return $null
}
function Save-AppChromeResumeState([string]$installedSha,[string]$result,[string]$reason,[bool]$reported){
  $d=[ordered]@{schema='TIGERIQ_APP_CHROME_RUNTIME_RECOVERY_V1';installedSha=$installedSha;result=$result;reason=$reason;reported=$reported;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp="$appChromeResumeState.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $appChromeResumeState
}
function Report-AppChromeResume([string]$installedSha,[string]$result,[string]$reason,$state){
  $nv02=@($state.workers|Where-Object{$_.id -eq 'NV02'}|Select-Object -First 1)
  $body=@(
    'TIGERIQ_APP_CHROME_RUNTIME_RECOVERY_V1',
    ('installedSha='+$installedSha),
    ('result='+$result),
    ('reason='+$reason),
    ('paused='+[string][bool]$state.paused),
    ('killed='+[string][bool]$state.killed),
    ('ownerInteractionMode='+[string]$state.ownerInteractionMode),
    ('externalWorkAutopilotEnabled='+[string][bool]$state.externalWorkAutopilotEnabled),
    ('nv02WindowState='+[string]$nv02.windowState),
    ('nv02Blocked='+[string][bool]$nv02.blocked),
    'rawOutputPublished=false'
  ) -join [Environment]::NewLine
  if(Test-GithubApiBackoff){return $false}
  $raw=(& gh issue comment $appChromeIssue --repo newsdayads/tigeriq-ai-lab --body $body 2>&1|Out-String)
  if($LASTEXITCODE -ne 0){$null=Set-GithubApiBackoffFromText $raw;return $false}
  return $true
}
function Invoke-AppChromeOwnerResume([string]$installedSha){
  if(-not(Owner-AppChromeResumeRequested)){return @{action='none';reason='not_requested'}}
  $after=$null
  try{
    $before=Invoke-RestMethod -Uri ($appChromeController+'/api/state') -TimeoutSec 5
    $workers=@($before.workers)
    $nv02=@($workers|Where-Object{$_.id -eq 'NV02'}|Select-Object -First 1)
    $needsResume=[bool]$before.paused -or [bool]$before.killed -or [string]$before.ownerInteractionMode -eq 'READ_ONLY' -or -not [bool]$before.externalWorkAutopilotEnabled
    $needsStart=($null -eq $nv02) -or ([string]$nv02.windowState -notmatch 'OPEN|RUNNING|READY|WORKING')
    $needsUnblock=($null -ne $nv02) -and [bool]$nv02.blocked
    if($needsResume){Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($appChromeController+'/api/resume') -TimeoutSec 10|Out-Null}
    if($needsUnblock){Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($appChromeController+'/api/workers/NV02/unblock') -TimeoutSec 15|Out-Null}
    if($needsStart){Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($appChromeController+'/api/start-all') -TimeoutSec 20|Out-Null}
    if($needsResume -or $needsUnblock -or $needsStart){Start-Sleep -Seconds 3}
    $after=Invoke-RestMethod -Uri ($appChromeController+'/api/state') -TimeoutSec 5
    $nv02After=@($after.workers|Where-Object{$_.id -eq 'NV02'}|Select-Object -First 1)
    $ok=(-not [bool]$after.paused) -and (-not [bool]$after.killed) -and ([string]$after.ownerInteractionMode -ne 'READ_ONLY') -and ($null -ne $nv02After) -and (-not [bool]$nv02After.blocked)
    $result=if($ok){'PASS'}else{'BLOCKED'}
    $reason=if($ok){'NV02_RUNTIME_RESUMED'}else{'CONTROLLER_STATE_NOT_RECOVERED'}
    $previous=Get-AppChromeResumeState
    $reported=[bool]($previous -and [string]$previous.installedSha -eq $installedSha -and [string]$previous.result -eq $result -and [bool]$previous.reported)
    if(-not $reported){$reported=Report-AppChromeResume $installedSha $result $reason $after}
    Save-AppChromeResumeState $installedSha $result $reason $reported
    return @{action=if($needsResume -or $needsUnblock -or $needsStart){'recovered'}else{'verified'};result=$result;reason=$reason;reported=$reported}
  }catch{
    $reason=('APP_CHROME_RECOVERY_EXCEPTION_'+$_.Exception.GetType().Name)
    Save-AppChromeResumeState $installedSha 'BLOCKED' $reason $false
    return @{action='blocked';result='BLOCKED';reason=$reason;reported=$false}
  }
}
function Invoke-AppChromeZeroTouchHelper(){
  if(-not(Test-Path -LiteralPath $appChromeZeroTouchScript)){return @{action='none';reason='helper_missing'}}
  if(Test-GithubApiBackoff){return @{action='deferred';reason='github_rate_limit_backoff'}}
  $now=(Get-Date).ToUniversalTime()
  if((($now-$script:lastAppChromeInstallPoll).TotalSeconds) -lt $appChromeInstallPollIntervalSec){return @{action='deferred';reason='poll_interval'}}
  $script:lastAppChromeInstallPoll=$now
  try{
    $raw=(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $appChromeZeroTouchScript 2>$null|Out-String).Trim()
    $exitCode=$LASTEXITCODE
    $null=Set-GithubApiBackoffFromText $raw
    if($raw){
      $last=@($raw -split "`r?`n"|Where-Object{$_ -and $_.Trim()}|Select-Object -Last 1)
      try{$parsed=($last|Out-String).Trim()|ConvertFrom-Json -ErrorAction Stop;return $parsed}catch{}
    }
    if($exitCode -eq 0){return @{action='none';reason='helper_no_output'}}
    return @{action='blocked';reason=('helper_exit_'+$exitCode)}
  }catch{return @{action='blocked';reason=('helper_exception_'+$_.Exception.GetType().Name)}}
}
function Task-Exists([string]$name){return [bool](Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)}
function Get-RemoteDesktopRuntimeProcesses(){
  try{
    $needle=(Join-Path $remoteDesktopRuntime 'app-0.2.51').ToLowerInvariant()
    return @(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object{
      $cmd=[string]$_.CommandLine
      [string]$_.Name -ieq 'node.exe' -and $cmd -and $cmd.ToLowerInvariant().Contains($needle)
    })
  }catch{return @()}
}
function Get-RemoteDesktopLauncherProcesses(){
  return @(Get-RemoteDesktopRuntimeProcesses|Where-Object{[string]$_.CommandLine -match '(?i)\sremote(?:\s|$)'})
}
function Stop-RemoteDesktopRuntimeProcesses(){
  $stopped=@()
  foreach($p in @(Get-RemoteDesktopRuntimeProcesses)){
    try{Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction Stop;$stopped+=([int]$p.ProcessId)}catch{}
  }
  return @($stopped)
}
function Get-RemoteDesktopLifecycleGeneration(){
  try{if(Test-Path -LiteralPath $remoteDesktopLifecycleState){return (Get-Content -LiteralPath $remoteDesktopLifecycleState -Raw).Trim()}}catch{}
  return ''
}
function Save-RemoteDesktopLifecycleGeneration(){
  $tmp=$remoteDesktopLifecycleState+'.tmp'
  [IO.File]::WriteAllText($tmp,$remoteDesktopLifecycleGeneration,(New-Object Text.UTF8Encoding($false)))
  Move-Item -Force $tmp $remoteDesktopLifecycleState
}
function Restart-RemoteDesktopTaskClean([string]$reason,$result,[string]$authorizer){
  Stop-ScheduledTask -TaskName $remoteDesktopTask -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $stopped=@(Stop-RemoteDesktopRuntimeProcesses)
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName $remoteDesktopTask -ErrorAction Stop
  $deadline=(Get-Date).AddSeconds(30)
  do{
    Start-Sleep -Milliseconds 500
    $task=Get-ScheduledTask -TaskName $remoteDesktopTask -ErrorAction SilentlyContinue
    $runtimeCount=@(Get-RemoteDesktopRuntimeProcesses).Count
    $launcherCount=@(Get-RemoteDesktopLauncherProcesses).Count
    if($task -and [string]$task.State -eq 'Running' -and $launcherCount -eq 1 -and $runtimeCount -eq 2){
      Save-RemoteDesktopLifecycleGeneration
      return @{action='restarted';reason=$reason;task=$remoteDesktopTask;taskState='Running';remoteProcessCount=$runtimeCount;remoteLauncherCount=$launcherCount;stoppedPids=$stopped;version=[string]$result.version;authorizer=$authorizer;changes=@($result.changes)}
    }
  }while((Get-Date)-lt$deadline)
  return @{action='blocked';reason='rdc_topology_not_recovered';task=$remoteDesktopTask;remoteProcessCount=@(Get-RemoteDesktopRuntimeProcesses).Count;remoteLauncherCount=@(Get-RemoteDesktopLauncherProcesses).Count;stoppedPids=$stopped;version=[string]$result.version;changes=@($result.changes)}
}
function Reconcile-RemoteDesktopGuard(){
  if(-not(Test-Path -LiteralPath $remoteDesktopGuardInstaller)){return @{action='skip';reason='installer_missing'}}
  if(-not(Task-Exists $remoteDesktopTask)){return @{action='blocked';reason='task_missing';task=$remoteDesktopTask}}
  try{
    $raw=(& node $remoteDesktopGuardInstaller 2>&1|Out-String).Trim()
    $exitCode=$LASTEXITCODE
    if($exitCode -ne 0){
      return @{action='blocked';reason=('installer_exit_'+$exitCode);detail=([string]$raw).Substring(0,[Math]::Min(500,[string]$raw.Length))}
    }
    $last=@($raw -split "`r?`n"|Where-Object{$_ -and $_.Trim()}|Select-Object -Last 1)
    if(-not $last){return @{action='blocked';reason='installer_no_output'}}
    $result=(($last|Out-String).Trim()|ConvertFrom-Json -ErrorAction Stop)
    if(-not [bool]$result.ok){return @{action='blocked';reason='installer_not_ok';detail=$result}}
    $authorizer=if($result.PSObject.Properties.Name -contains 'authorizer'){[string]$result.authorizer}else{'tigeriq_authorize_mutation'}
    $lifecycleCurrent=(Get-RemoteDesktopLifecycleGeneration) -eq $remoteDesktopLifecycleGeneration
    $runtimeCount=@(Get-RemoteDesktopRuntimeProcesses).Count
    $launcherCount=@(Get-RemoteDesktopLauncherProcesses).Count
    $topologyHealthy=($launcherCount -eq 1 -and $runtimeCount -eq 2)
    $needsLifecycleRepair=(-not $lifecycleCurrent) -or (-not $topologyHealthy)
    if(-not [bool]$result.changed -and -not $needsLifecycleRepair){
      return @{action='verified';reason='guard_current_topology_healthy';version=[string]$result.version;authorizer=$authorizer;changes=@();remoteProcessCount=$runtimeCount;remoteLauncherCount=$launcherCount;lifecycleGeneration=$remoteDesktopLifecycleGeneration}
    }
    $reason=if([bool]$result.changed){'guard_updated_clean_restart'}elseif(-not $lifecycleCurrent){'lifecycle_generation_repair'}else{('remote_topology_'+$launcherCount+'_'+$runtimeCount)}
    return Restart-RemoteDesktopTaskClean $reason $result $authorizer
  }catch{
    return @{action='blocked';reason=('RDC_GUARD_'+$_.Exception.GetType().Name);detail=[string]$_.Exception.Message}
  }
}
function Sync-LiveStatusBridgeRuntime(){
  try{
    if(-not(Test-Path -LiteralPath $liveStatusBridgeSource)){return [ordered]@{status='BLOCKED';reason='SOURCE_MISSING';action='NONE'}}
    $dir=Split-Path -Parent $liveStatusBridgeRuntime
    if(-not(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir -Force|Out-Null}
    $sourceHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $liveStatusBridgeSource).Hash
    $runtimeHash=if(Test-Path -LiteralPath $liveStatusBridgeRuntime){(Get-FileHash -Algorithm SHA256 -LiteralPath $liveStatusBridgeRuntime).Hash}else{''}
    if($sourceHash -eq $runtimeHash){return [ordered]@{status='HEALTHY';reason='SOURCE_MATCH';action='NONE';sha256=$sourceHash}}
    Copy-Item -LiteralPath $liveStatusBridgeSource -Destination $liveStatusBridgeRuntime -Force
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($liveStatusBridgeRuntime.ToLowerInvariant()) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    return [ordered]@{status='RECONCILED';reason='SOURCE_UPDATED';action='RESTART_REQUIRED';sha256=$sourceHash}
  }catch{
    return [ordered]@{status='BLOCKED';reason=$_.Exception.Message;action='NONE'}
  }
}
function Test-LiveStatusBridgeHealth(){
  try{
    $local=Invoke-RestMethod -Uri 'http://127.0.0.1:8801/health' -TimeoutSec 4
    if(-not $local.ok){return $false}
    if(-not(Test-Path -LiteralPath $liveStatusBridgeState)){return $false}
    $stateData=Get-Content -Raw -LiteralPath $liveStatusBridgeState|ConvertFrom-Json
    $url=[string]$stateData.url
    if(-not $url.StartsWith('https://')){return $false}
    $public=Invoke-RestMethod -Uri ($url.TrimEnd('/')+'/health') -TimeoutSec 8
    return [bool]($public.ok -and [string]$public.service -eq 'tigeriq-live-status-bridge')
  }catch{return $false}
}
function Invoke-LiveStatusBridgeReconcile(){
  try {
    if(Test-LiveStatusBridgeHealth){return [ordered]@{status='HEALTHY';reason='LOCAL_AND_PUBLIC_OK';action='NONE'}}
    if(-not (Task-Exists $liveStatusBridgeTask)) {return [ordered]@{status='BLOCKED';reason='TASK_ABSENT';action='NONE'}}
    $st=Get-ScheduledTask -TaskName $liveStatusBridgeTask -ErrorAction SilentlyContinue
    if(-not $st){return [ordered]@{status='BLOCKED';reason='TASK_NOT_FOUND';action='NONE'}}
    if([string]$st.State -ne 'Running'){Start-ScheduledTask -TaskName $liveStatusBridgeTask -ErrorAction Stop}
    $deadline=(Get-Date).AddSeconds(90)
    do{
      Start-Sleep -Seconds 2
      if(Test-LiveStatusBridgeHealth){return [ordered]@{status='RECONCILED';reason='HEALTH_RECOVERED';action='START'}}
    }while((Get-Date)-lt$deadline)
    return [ordered]@{status='BLOCKED';reason='HEALTH_TIMEOUT';action='START_ATTEMPTED'}
  } catch {
    return [ordered]@{status='BLOCKED';reason=$_.Exception.Message;action='NONE'}
  }
}

function Test-TcpPort([string]$targetHost,[int]$port,[int]$timeoutMs=2500){
  $client=New-Object Net.Sockets.TcpClient
  try{
    $async=$client.BeginConnect($targetHost,$port,$null,$null)
    if(-not $async.AsyncWaitHandle.WaitOne($timeoutMs,$false)){return $false}
    $client.EndConnect($async)
    return [bool]$client.Connected
  }catch{return $false}
  finally{$client.Close()}
}
function OpenClaw-TreeSha(){
  if(-not(Test-Path -LiteralPath $runtimeRepo)){return $null}
  $sha=(& git -C $runtimeRepo rev-parse 'HEAD:apps/openclaw-tigeriq-runtime' 2>$null|Out-String).Trim()
  if($LASTEXITCODE -ne 0 -or -not $sha){return $null}
  return $sha
}
function Save-OpenClawAppliedState([string]$treeSha){
  $d=[ordered]@{schema='TIGERIQ_OPENCLAW_RUNTIME_V1';treeSha=$treeSha;port=18789;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp="$openclawState.tmp";[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $openclawState
}
function Get-OpenClawAppliedTree(){
  try{if(Test-Path -LiteralPath $openclawState){$d=Get-Content -LiteralPath $openclawState -Raw|ConvertFrom-Json;return [string]$d.treeSha}}catch{}
  return $null
}
function Restart-OpenClawGateway(){
  if(-not(Task-Exists $openclawTask)){throw ('TASK_MISSING:'+ $openclawTask)}
  Stop-ScheduledTask -TaskName $openclawTask -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $openclawTask
  $deadline=(Get-Date).AddSeconds($openclawGatewayStartupTimeoutSec)
  while((Get-Date)-lt$deadline){
    $task=Get-ScheduledTask -TaskName $openclawTask -ErrorAction SilentlyContinue
    if($task -and $task.State -eq 'Running' -and (Test-TcpPort '127.0.0.1' 18789)){return @{healthy=$true;port=18789;taskState=[string]$task.State}}
    Start-Sleep -Seconds 2
  }
  return $null
}
function Reconcile-OpenClawRuntime([string]$installedSha){
  $treeSha=OpenClaw-TreeSha
  if(-not $treeSha){return @{action='skip';reason='plugin_tree_missing'}}
  $applied=Get-OpenClawAppliedTree
  if($applied -eq $treeSha){
    return @{action='none';treeSha=$treeSha;portHealthy=(Test-TcpPort '127.0.0.1' 18789)}
  }
  $previous=Get-OpenClawCanaryState
  if($previous -and [string]$previous.installedSha -eq $installedSha -and [string]$previous.treeSha -eq $treeSha -and ($previous.PSObject.Properties.Name -contains 'policyGeneration') -and [string]$previous.policyGeneration -eq $openclawCanaryPolicyGeneration -and [string]$previous.result -ne 'PASS'){
    return @{action='blocked';reason='terminal_canary_blocked';treeSha=$treeSha;portHealthy=(Test-TcpPort '127.0.0.1' 18789)}
  }
  if(-not(Task-Exists $openclawTask)){return @{action='blocked';reason='task_missing';treeSha=$treeSha}}
  $health=Restart-OpenClawGateway
  if(-not $health){throw 'OPENCLAW_GATEWAY_HEALTH_FAILED'}
  return @{action='restarted';treeSha=$treeSha;portHealthy=$true}
}
function Get-OpenClawCanaryState(){
  try{if(Test-Path -LiteralPath $openclawCanaryState){return (Get-Content -LiteralPath $openclawCanaryState -Raw|ConvertFrom-Json)}}catch{}
  return $null
}
function Save-OpenClawCanaryState([string]$installedSha,[string]$treeSha,[string]$result,[string]$reason,[bool]$reported){
  $d=[ordered]@{schema='TIGERIQ_OPENCLAW_CANARY_V2';policyGeneration=$openclawCanaryPolicyGeneration;installedSha=$installedSha;treeSha=$treeSha;result=$result;reason=$reason;reported=$reported;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp=$openclawCanaryState+'.tmp';[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $openclawCanaryState
}
function Report-OpenClawCanary([string]$installedSha,[string]$treeSha,[string]$result,[string]$reason){
  $body=@(
    'TIGERIQ_OPENCLAW_CANARY_V2',
    ('policyGeneration='+$openclawCanaryPolicyGeneration),
    ('installedSha='+$installedSha),
    ('pluginTreeSha='+$treeSha),
    ('result='+$result),
    ('reason='+$reason),
    'runner=deterministic-node',
    'tools=tigeriq_runtime,tigeriq_pc',
    'actions=core_status,task_status,tcp_probe,shell_exec,file_write,file_read',
    'pcTask=TigerIQ OpenClaw Gateway',
    'canaryScript=D:\TigerIQ\Runtime\CoreSource\apps\openclaw-tigeriq-runtime\canary.mjs',
    'pcCanaryFile=D:\TigerIQ\State\openclaw-pc-operator-canary.txt',
    'rawOutputPublished=false'
  ) -join [Environment]::NewLine
  if(Test-GithubApiBackoff){return $false}
  $raw=(& gh issue comment $openclawCanaryIssue --repo newsdayads/tigeriq-ai-lab --body $body 2>&1|Out-String)
  if($LASTEXITCODE -ne 0){$null=Set-GithubApiBackoffFromText $raw;return $false}
  return $true
}
function Invoke-OpenClawCanary([string]$installedSha,[string]$treeSha){
  if(-not $installedSha -or -not $treeSha){return @{action='skip';reason='identity_missing'}}
  $previous=Get-OpenClawCanaryState
  if($previous -and [string]$previous.installedSha -eq $installedSha -and [string]$previous.treeSha -eq $treeSha -and ($previous.PSObject.Properties.Name -contains 'policyGeneration') -and [string]$previous.policyGeneration -eq $openclawCanaryPolicyGeneration){
    $previousReported=[bool]$previous.reported
    if(-not $previousReported){
      $previousReported=Report-OpenClawCanary $installedSha $treeSha ([string]$previous.result) ([string]$previous.reason)
      Save-OpenClawCanaryState $installedSha $treeSha ([string]$previous.result) ([string]$previous.reason) $previousReported
    }
    return @{action='none';result=[string]$previous.result;reason=[string]$previous.reason;reported=$previousReported}
  }
  $result='BLOCKED';$reason='UNKNOWN';$reported=$false
  try{
    if(-not(Test-Path -LiteralPath $openclawCanaryScript)){$reason='OPENCLAW_CANARY_SCRIPT_MISSING'}
    elseif(-not(Task-Exists $openclawTask) -or -not(Test-TcpPort '127.0.0.1' 18789)){$reason='OPENCLAW_GATEWAY_UNHEALTHY'}
    else{
      $oldGh=$env:GH_TOKEN
      try{
        Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
        $output=(& node $openclawCanaryScript 2>&1|Out-String).Trim()
        $exitCode=$LASTEXITCODE
      }finally{
        if($null -ne $oldGh){$env:GH_TOKEN=$oldGh}else{Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue}
      }
      if($exitCode -ne 0){$reason=('OPENCLAW_CANARY_EXIT_'+$exitCode)}
      else{
        try{
          $parsed=$output|ConvertFrom-Json -ErrorAction Stop
          if([string]$parsed.schema -ne 'TIGERIQ_OPENCLAW_CANARY_EXEC_V1'){$reason='DETERMINISTIC_CANARY_INVALID_SCHEMA'}
          elseif([string]$parsed.result -eq 'PASS' -and [string]$parsed.reason -eq 'PC_OPERATOR_E2E_PASS'){$result='PASS';$reason='PC_OPERATOR_E2E_PASS'}
          else{$reason='DETERMINISTIC_CANARY_BLOCKED'}
        }catch{$reason='DETERMINISTIC_CANARY_INVALID_OUTPUT'}
      }
    }
  }catch{$reason=('CANARY_EXCEPTION_'+$_.Exception.GetType().Name)}
  $reported=Report-OpenClawCanary $installedSha $treeSha $result $reason
  Save-OpenClawCanaryState $installedSha $treeSha $result $reason $reported
  return @{action='executed';result=$result;reason=$reason;reported=$reported}
}
function Gates-Pass([string]$sha){
  $runs=Invoke-GithubApiJson "repos/newsdayads/tigeriq-ai-lab/actions/runs?head_sha=$sha&status=completed&per_page=30"
  $need=@('CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify')
  foreach($n in $need){if(-not(@($runs.workflow_runs|Where-Object{$_.name -eq $n -and $_.conclusion -eq 'success'}))){return $false}}
  return $true
}
function Resolve-GateSha([string]$remote){
  if(Test-GithubApiBackoff){throw 'GITHUB_API_RATE_LIMIT_BACKOFF'}
  if(Gates-Pass $remote){return $remote}
  try{$prs=Invoke-GithubApiJson "repos/newsdayads/tigeriq-ai-lab/commits/$remote/pulls" @('Accept: application/vnd.github+json')}catch{if($_.Exception.Message -match '^GITHUB_API_RATE_LIMIT'){throw};return $null}
  foreach($pr in @($prs)){$head=[string]$pr.head.sha;if($head -and (Gates-Pass $head)){return $head}}
  return $null
}
function Get-NodePidByMatch([string]$match){
  $m=$match.ToLowerInvariant()
  $p=Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($m)} | Select-Object -First 1
  if($p){return [int]$p.ProcessId};return $null
}
function Stop-NodeProcessesByMatch([string]$match){
  $m=$match.ToLowerInvariant()
  $procs=Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($m)}
  foreach($p in $procs){try{Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop}catch{}}
}
function Get-CorePid(){$p=Get-NodePidByMatch $corePath;if($p){return $p};return Get-NodePidByMatch $legacyCorePath}
function Stop-CoreProcesses(){Stop-NodeProcessesByMatch $corePath;Stop-NodeProcessesByMatch $legacyCorePath}
function Restart-Core($oldPid){
  if(-not(Task-Exists $coreTask)){throw ('TASK_MISSING:'+ $coreTask)}
  $previousPid=if($null-ne$oldPid){[int]$oldPid}else{Get-CorePid}
  Stop-ScheduledTask -TaskName $coreTask -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2
  Stop-CoreProcesses;Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName $coreTask
  $deadline=(Get-Date).AddSeconds(60)
  while((Get-Date)-lt$deadline){
    $h=HealthInfo 'http://100.97.23.87:8795/health';$newPid=Get-CorePid
    if($h -and $newPid -and (($null-eq$previousPid)-or([int]$newPid-ne[int]$previousPid))){return $h}
    Start-Sleep -Seconds 2
  }
  return $null
}
function Restart-ServiceTask([string]$name,[string]$healthUrl,[string]$processMatch,[string]$legacyProcessMatch=''){
  if(-not(Task-Exists $name)){throw ('TASK_MISSING:'+ $name)}
  $oldPid=Get-NodePidByMatch $processMatch
  if(-not $oldPid -and $legacyProcessMatch){$oldPid=Get-NodePidByMatch $legacyProcessMatch}
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2
  Stop-NodeProcessesByMatch $processMatch
  if($legacyProcessMatch){Stop-NodeProcessesByMatch $legacyProcessMatch}
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName $name
  $deadline=(Get-Date).AddSeconds(45)
  while((Get-Date)-lt$deadline){
    $h=HealthInfo $healthUrl;$newPid=Get-NodePidByMatch $processMatch
    if($h -and $newPid -and (($null-eq$oldPid)-or([int]$newPid-ne[int]$oldPid))){return @{health=$h;pid=[int]$newPid;previousPid=$oldPid}}
    Start-Sleep -Seconds 2
  }
  return $null
}
function Sync-WebRuntime(){
  New-Item -ItemType Directory -Path $webRuntime -Force|Out-Null
  $files=@(
    @{src='apps\tigeriq-core\web-control-server.mjs';dst='web-control-server.mjs'},
    @{src='apps\tigeriq-core\web-control-truth.js';dst='web-control-truth.js'},
    @{src='apps\tigeriq-core\web-control.html';dst='web-control.html'},
    @{src='scripts\tigeriq-core\run-web-control-bundle.ps1';dst='run-web-control-bundle.ps1'}
  )
  foreach($f in $files){$source=Join-Path $runtimeRepo $f.src;if(-not(Test-Path -LiteralPath $source)){throw ('WEB_RUNTIME_SOURCE_MISSING:'+ $f.src)};$target=Join-Path $webRuntime $f.dst;$tmp=$target+'.tmp';Copy-Item -LiteralPath $source -Destination $tmp -Force;Move-Item -LiteralPath $tmp -Destination $target -Force}
}
function Ensure-ServiceHealth([string]$key,[string]$url){
  $h=HealthInfo $url
  if($h){$healthFailures[$key]=0;return @{service=$key;healthy=$true;action='none';pid=if($key-eq'web'){Get-NodePidByMatch $webPath}elseif($key-eq'coding'){Get-NodePidByMatch $codingPath}else{$h.pid}}}
  $healthFailures[$key]=[int]$healthFailures[$key]+1
  if($healthFailures[$key]-lt 2){return @{service=$key;healthy=$false;action='observe';failures=$healthFailures[$key]}}
  $since=((Get-Date)-[DateTime]$lastHeal[$key]).TotalSeconds
  if($since-lt$healCooldownSec){return @{service=$key;healthy=$false;action='cooldown';failures=$healthFailures[$key];cooldownRemainingSec=[int]($healCooldownSec-$since)}}
  $lastHeal[$key]=Get-Date
  try{
    if($key-eq'core'){$after=Restart-Core $null}
    elseif($key-eq'web'){Sync-WebRuntime;$after=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health' $webPath}
    elseif($key-eq'coding'){$after=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath $legacyCodingPath}
    else{throw ('UNKNOWN_SERVICE:'+ $key)}
    if($after){$healthFailures[$key]=0;return @{service=$key;healthy=$true;action='restarted';pid=$after.pid;previousPid=$after.previousPid}}
    return @{service=$key;healthy=$false;action='restart_failed';failures=$healthFailures[$key]}
  }catch{return @{service=$key;healthy=$false;action='restart_error';error=$_.Exception.Message;failures=$healthFailures[$key]}}
}
function Ensure-OpenClawHealth(){
  $task=Get-ScheduledTask -TaskName $openclawTask -ErrorAction SilentlyContinue
  $healthy=[bool]($task -and [string]$task.State -eq 'Running' -and (Test-TcpPort '127.0.0.1' 18789))
  if($healthy){$healthFailures.openclaw=0;return @{service='openclaw';healthy=$true;action='none';port=18789}}
  $healthFailures.openclaw=[int]$healthFailures.openclaw+1
  if($healthFailures.openclaw -lt 2){return @{service='openclaw';healthy=$false;action='observe';failures=$healthFailures.openclaw}}
  $since=((Get-Date)-[DateTime]$lastHeal.openclaw).TotalSeconds
  if($since-lt$healCooldownSec){return @{service='openclaw';healthy=$false;action='cooldown';failures=$healthFailures.openclaw}}
  $lastHeal.openclaw=Get-Date
  try{$after=Restart-OpenClawGateway;if($after){$healthFailures.openclaw=0;return @{service='openclaw';healthy=$true;action='restarted';port=18789}};return @{service='openclaw';healthy=$false;action='restart_failed'}}catch{return @{service='openclaw';healthy=$false;action='restart_error';error=$_.Exception.Message}}
}
function Ensure-AppChromeTransportHealth(){
  $task=Get-ScheduledTask -TaskName 'TigerIQ APP Chrome Unified' -ErrorAction SilentlyContinue
  $healthy=[bool]($task -and [string]$task.State -eq 'Running' -and (Test-TcpPort '127.0.0.1' 8798) -and (Test-TcpPort '127.0.0.1' 8799))
  if($healthy){$healthFailures.appchrome=0;return @{service='appchrome';healthy=$true;action='none';ports='8798,8799'}}
  $healthFailures.appchrome=[int]$healthFailures.appchrome+1
  if($healthFailures.appchrome -lt 2){return @{service='appchrome';healthy=$false;action='observe';failures=$healthFailures.appchrome}}
  $since=((Get-Date)-[DateTime]$lastHeal.appchrome).TotalSeconds
  if($since-lt$healCooldownSec){return @{service='appchrome';healthy=$false;action='cooldown';failures=$healthFailures.appchrome}}
  $lastHeal.appchrome=Get-Date
  try{
    if(-not $task){return @{service='appchrome';healthy=$false;action='blocked';reason='TASK_MISSING'}}
    if([string]$task.State -eq 'Running'){Stop-ScheduledTask -TaskName 'TigerIQ APP Chrome Unified' -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2}
    Start-ScheduledTask -TaskName 'TigerIQ APP Chrome Unified' -ErrorAction Stop
    Start-Sleep -Seconds 3
    $ok=(Test-TcpPort '127.0.0.1' 8798) -and (Test-TcpPort '127.0.0.1' 8799)
    if($ok){$healthFailures.appchrome=0;return @{service='appchrome';healthy=$true;action='restarted'}}
    return @{service='appchrome';healthy=$false;action='restart_failed'}
  }catch{return @{service='appchrome';healthy=$false;action='restart_error';error=$_.Exception.Message}}
}
function Runtime-Watchdog(){
  $events=@(
    (Ensure-ServiceHealth 'core' 'http://100.97.23.87:8795/health'),
    (Ensure-ServiceHealth 'web' 'http://100.97.23.87:8796/health'),
    (Ensure-ServiceHealth 'coding' 'http://100.97.23.87:8797/health'),
    (Ensure-OpenClawHealth),
    (Ensure-AppChromeTransportHealth)
  )
  return @{ok=(@($events|Where-Object{-not $_.healthy}).Count-eq 0);updaterRunning=$true;services=$events;checkedAt=(Get-Date).ToUniversalTime().ToString('o')}
}
function Get-Impact([string[]]$paths){
  $web=[bool](@($paths|Where-Object{$_ -match '^apps/tigeriq-core/web-control(?:\.|-)' -or $_ -match '^scripts/tigeriq-core/(?:run|install)-web-control'}).Count)
  $coding=[bool](@($paths|Where-Object{$_ -match '^apps/tigeriq-coding-lane/' -or $_ -match '^scripts/tigeriq-core/(?:run|install)-coding-lane'}).Count)
  $openclaw=[bool](@($paths|Where-Object{$_ -match '^apps/openclaw-tigeriq-runtime/'}).Count)
  $core=[bool](@($paths|Where-Object{($_ -match '^apps/tigeriq-core/' -and $_ -notmatch '^apps/tigeriq-core/web-control(?:\.|-)') -or $_ -match '^scripts/tigeriq-core/(?:run-core|install-core-task)\.ps1$'}).Count -or $openclaw)
  $updater=[bool](@($paths|Where-Object{$_ -eq 'scripts/tigeriq-core/update-core-runtime.ps1'}).Count)
  $liveBridge=[bool](@($paths|Where-Object{$_ -match '^apps/tigeriq-live-bridge/'}).Count)
  return @{core=$core;web=$web;coding=$coding;openclaw=$openclaw;updater=$updater;liveBridge=$liveBridge}
}
function Restart-UpdaterAfterExit(){
  $cmd="Start-Sleep -Seconds 4; Start-ScheduledTask -TaskName '$updaterTask'"
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-Command',$cmd) -WindowStyle Hidden|Out-Null
}
while($true){
  $locked=$false
  try{
    $locked=$mutex.WaitOne(0);if(-not $locked){Start-Sleep -Seconds $IntervalSeconds;continue}
    $webTaskTarget=Ensure-WebTaskRuntimeTarget
    $appChromeTaskBlueprintState=Sync-AppChromeTaskBlueprint
    $watchdog=Runtime-Watchdog
    $legacyLifecycleRetire=Retire-LegacyOpenClawLifecycleOwner
    $liveStatusBridgeSync=Sync-LiveStatusBridgeRuntime
    $liveStatusBridgeReconcile=Invoke-LiveStatusBridgeReconcile
    if(-not(Test-Path -LiteralPath $tokenPath)){Save-State @{result='GITHUB_TOKEN_MISSING';liveStatusBridgeSync=$liveStatusBridgeSync;liveStatusBridgeReconcile=$liveStatusBridgeReconcile;watchdog=$watchdog};continue}
    $env:GH_TOKEN=[IO.File]::ReadAllText($tokenPath).Trim();if(-not $env:GH_TOKEN){Save-State @{result='GITHUB_TOKEN_EMPTY';liveStatusBridgeSync=$liveStatusBridgeSync;liveStatusBridgeReconcile=$liveStatusBridgeReconcile;watchdog=$watchdog};continue}
    $bootstrapWatchdog=if(Test-Path -LiteralPath $runtimeRepo){Ensure-BootstrapWatchdogTask}else{@{action='skip';reason='runtime_missing'}}
    $appChromeInstall=Invoke-AppChromeZeroTouchHelper
    $runtimeIdentity=if(Test-Path -LiteralPath $runtimeRepo){Head $runtimeRepo 'HEAD'}else{'BOOTSTRAP'}
    $appChromeRecovery=Invoke-AppChromeOwnerResume $runtimeIdentity
    git -C $controlRepo fetch origin main --prune|Out-Null;if($LASTEXITCODE -ne 0){throw 'FETCH_FAILED'}
    $remote=Head $controlRepo 'origin/main';if(-not $remote){throw 'REMOTE_MAIN_MISSING'}
    $runtimeExists=Test-Path -LiteralPath $runtimeRepo
    if($runtimeExists -and (Runtime-Source-Dirty)){Save-State @{result='BLOCKED_DIRTY_RUNTIME';runtimeSource=$runtimeRepo;liveStatusBridgeSync=$liveStatusBridgeSync;liveStatusBridgeReconcile=$liveStatusBridgeReconcile;watchdog=$watchdog};continue}
    $updaterTaskTarget=if($runtimeExists){Ensure-UpdaterTaskRuntimeTarget}else{@{action='skip';reason='runtime_missing';target=$updaterRuntime}}
    $local=if($runtimeExists){Head $runtimeRepo 'HEAD'}else{$null}
    $openclawReconcile=@{action='skip';reason='runtime_missing'}
    $preOpenclawCanary=@{action='skip';reason='runtime_missing'}
    if($runtimeExists){
      try{
        $openclawReconcile=Reconcile-OpenClawRuntime $local
        $preOpenclawCanary=if($local){Invoke-OpenClawCanary $local (OpenClaw-TreeSha)}else{@{action='skip';reason='identity_missing'}}
        if([string]$openclawReconcile.action -eq 'restarted' -and [string]$preOpenclawCanary.result -eq 'PASS'){Save-OpenClawAppliedState (OpenClaw-TreeSha)}
      }catch{
        $openclawReconcile=@{action='blocked';reason=('OBSERVE_'+$_.Exception.Message)}
        $preOpenclawCanary=@{action='blocked';result='BLOCKED';reason='OPENCLAW_DEGRADED_NONBLOCKING'}
      }
    }
    if(Test-GithubApiBackoff){$remoteDesktopGuard=Reconcile-RemoteDesktopGuard;Save-State @{result='WAIT_GITHUB_API_RATE_LIMIT';candidateSha=$remote;installedSha=$local;githubApiBackoffUntil=$githubApiBackoffUntil.ToString('o');runtimeSource=$runtimeRepo;liveStatusBridgeSync=$liveStatusBridgeSync;liveStatusBridgeReconcile=$liveStatusBridgeReconcile;remoteDesktopGuard=$remoteDesktopGuard;updaterTaskTarget=$updaterTaskTarget;webTaskTarget=$webTaskTarget;watchdog=$watchdog};Start-Sleep -Seconds $IntervalSeconds;continue}
    if($runtimeExists -and $local -eq $remote){$remoteDesktopGuard=Reconcile-RemoteDesktopGuard;Save-State @{result='NO_CHANGE';installedSha=$local;runtimeSource=$runtimeRepo;bootstrapWatchdog=$bootstrapWatchdog;appChromeTaskBlueprint=$appChromeTaskBlueprintState;appChromeInstall=$appChromeInstall;appChromeRecovery=$appChromeRecovery;legacyLifecycleRetire=$legacyLifecycleRetire;liveStatusBridgeSync=$liveStatusBridgeSync;liveStatusBridgeReconcile=$liveStatusBridgeReconcile;openclawReconcile=$openclawReconcile;openclawCanary=$preOpenclawCanary;remoteDesktopGuard=$remoteDesktopGuard;updaterTaskTarget=$updaterTaskTarget;webTaskTarget=$webTaskTarget;watchdog=$watchdog};Start-Sleep -Seconds $IntervalSeconds;continue}
    $gateSha=Resolve-GateSha $remote
    if(-not $gateSha){Save-State @{result='WAIT_GATES';candidateSha=$remote;runtimeSource=$runtimeRepo;liveStatusBridgeSync=$liveStatusBridgeSync;liveStatusBridgeReconcile=$liveStatusBridgeReconcile;watchdog=$watchdog};continue}
    [string[]]$changed=if($runtimeExists){@(git -C $controlRepo diff --name-only $local $remote)}else{@('apps/tigeriq-core/','apps/tigeriq-coding-lane/','scripts/tigeriq-core/')}
    $impact=if($runtimeExists){Get-Impact $changed}else{@{core=$true;web=$true;coding=$true;openclaw=$false;updater=$true;bootstrap=$true}}
    $oldCore=HealthInfo 'http://100.97.23.87:8795/health';$oldPid=if($oldCore){[int]$oldCore.pid}else{$null}
    $previousRuntimeSha=$local
    Ensure-RuntimeSource $remote
    Ensure-NodeModules $runtimeRepo
    $liveStatusBridgeSync=Sync-LiveStatusBridgeRuntime
    $liveStatusBridgeReconcile=Invoke-LiveStatusBridgeReconcile
    $remoteDesktopGuard=Reconcile-RemoteDesktopGuard
    Save-RuntimeSourceState $remote $previousRuntimeSha $gateSha
    Sync-Launchers
    $bootstrapWatchdog=Ensure-BootstrapWatchdogTask
    if($impact.updater){Sync-UpdaterRuntime;$updaterTaskTarget=Ensure-UpdaterTaskRuntimeTarget}
    $coreHealth=$oldCore;$webHealth=$null;$codingHealth=$null;$openclawHealth=$null;$openclawCanary=$null
    try{
      if($impact.core){$coreHealth=Restart-Core $oldPid;if(-not $coreHealth){throw 'CORE_HEALTH_OR_PID_FAILED'}}
      elseif(-not(HealthInfo 'http://100.97.23.87:8795/health')){throw 'CORE_HEALTH_LOST_WITHOUT_CORE_CHANGE'}
      if($impact.web){Sync-WebRuntime;$webHealth=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health' $webPath;if(-not $webHealth){throw 'WEB_CONTROL_HEALTH_OR_PID_FAILED'}}
      if($impact.coding){$codingHealth=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath $legacyCodingPath;if(-not $codingHealth){throw 'CODING_LANE_HEALTH_OR_PID_FAILED'}}
      if($impact.openclaw){$openclawHealth=Restart-OpenClawGateway;if(-not $openclawHealth){throw 'OPENCLAW_GATEWAY_HEALTH_FAILED'}}
      if($impact.openclaw){
        $tree=OpenClaw-TreeSha
        $openclawCanary=Invoke-OpenClawCanary $remote $tree
        if(-not $openclawCanary -or [string]$openclawCanary.result -ne 'PASS'){
          $why=if($openclawCanary){[string]$openclawCanary.reason}else{'NO_RESULT'}
          throw ('OPENCLAW_FUNCTIONAL_CANARY_FAILED:'+ $why)
        }
        if($impact.openclaw){Save-OpenClawAppliedState $tree}
      }
    }catch{
      if($previousRuntimeSha){
        git -C $runtimeRepo reset --hard $previousRuntimeSha|Out-Null
        Save-RuntimeSourceState $previousRuntimeSha $remote $previousRuntimeSha
        Sync-Launchers
        $liveStatusBridgeSync=Sync-LiveStatusBridgeRuntime
        $liveStatusBridgeReconcile=Invoke-LiveStatusBridgeReconcile
        if($impact.updater){Sync-UpdaterRuntime}
      }else{
        git -C $controlRepo worktree remove --force $runtimeRepo 2>$null|Out-Null
        Remove-Item -LiteralPath $runtimeSourceState -Force -ErrorAction SilentlyContinue
      }
      if($impact.core){$null=Restart-Core $null}
      if($impact.web -and (Task-Exists $webTask)){Sync-WebRuntime;$null=Restart-ServiceTask $webTask 'http://100.97.23.87:8796/health' $webPath}
      if($impact.coding -and (Task-Exists $codingTask)){$null=Restart-ServiceTask $codingTask 'http://100.97.23.87:8797/health' $codingPath $legacyCodingPath}
      if($impact.openclaw -and (Task-Exists $openclawTask)){$null=Restart-OpenClawGateway;$rollbackTree=OpenClaw-TreeSha;if($rollbackTree){Save-OpenClawAppliedState $rollbackTree}}
      throw ('ROLLED_BACK:'+ $_.Exception.Message)
    }
    $newCore=HealthInfo 'http://100.97.23.87:8795/health'
    if($impact.openclaw -and $null -eq $openclawCanary){$openclawCanary=Invoke-OpenClawCanary $remote (OpenClaw-TreeSha)}
    Save-State @{result='UPDATED';appChromeTaskBlueprint=$appChromeTaskBlueprintState;liveStatusBridgeSync=$liveStatusBridgeSync;liveStatusBridgeReconcile=$liveStatusBridgeReconcile;appChromeInstall=$appChromeInstall;installedSha=$remote;gateSha=$gateSha;previousSha=$previousRuntimeSha;runtimeSource=$runtimeRepo;appChromeRecovery=$appChromeRecovery;legacyLifecycleRetire=$legacyLifecycleRetire;changedPaths=$changed;impact=$impact;updaterTaskTarget=$updaterTaskTarget;openclawReconcile=$openclawReconcile;openclawCanary=$openclawCanary;corePid=if($newCore){[int]$newCore.pid}else{$null};previousCorePid=$oldPid;coreRestarted=$impact.core;webRestarted=$impact.web;codingRestarted=$impact.coding;openclawRestarted=$impact.openclaw;openclawPortHealthy=if($openclawHealth){[bool]$openclawHealth.healthy}else{$null};remoteDesktopGuard=$remoteDesktopGuard;webPid=if($webHealth){$webHealth.pid}else{$null};codingPid=if($codingHealth){$codingHealth.pid}else{$null};watchdog=$watchdog}
    if($impact.updater){Restart-UpdaterAfterExit;exit 75}
  }catch{Save-State @{result='FAILED';error=$_.Exception.Message;watchdog=$watchdog}}
  finally{Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue;if($locked){$mutex.ReleaseMutex()|Out-Null}}
  Start-Sleep -Seconds $IntervalSeconds
}
