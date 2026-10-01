param(
  [string]$Repo='newsdayads/tigeriq-ai-lab',
  [string]$InstallRoot='D:\TigerIQ\Apps\ChromeController',
  [string]$StateRoot='D:\TigerIQ\State'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$controller='http://127.0.0.1:8798'
$bridge='http://127.0.0.1:8799'
$requestPath=Join-Path $StateRoot 'appchrome-install-request.json'
$resultPath=Join-Path $StateRoot 'appchrome-install-result.json'
$stageRoot=Join-Path $StateRoot 'AppChromeInstall'
$singleFlight=New-Object Threading.Mutex($false,'Global\TigerIQAppChromeZeroTouchV1')
$ownsSingleFlight=$false
function Release-SingleFlight(){
  if($script:ownsSingleFlight){try{$script:singleFlight.ReleaseMutex()}catch{};$script:ownsSingleFlight=$false}
  try{$script:singleFlight.Dispose()}catch{}
}
try{$ownsSingleFlight=$singleFlight.WaitOne(0)}catch [Threading.AbandonedMutexException]{$ownsSingleFlight=$true}
if(-not $ownsSingleFlight){try{$singleFlight.Dispose()}catch{};[pscustomobject]@{action='none';reason='install_inflight'}|ConvertTo-Json -Compress;exit 0}

function Exact-Line([string]$body,[string]$key,[string]$value){
  $escapedKey=[regex]::Escape($key);$escapedValue=[regex]::Escape($value)
  return [bool]($body -match ('(?m)^'+$escapedKey+'='+$escapedValue+'\s*$'))
}
function Body-Value([string]$body,[string]$key){
  $m=[regex]::Match($body,('(?m)^'+[regex]::Escape($key)+'=(.+)$'))
  if($m.Success){return $m.Groups[1].Value.Trim()};return ''
}
function Save-Result([string]$result,[string]$reason,$req,$details=$null){
  New-Item -ItemType Directory -Path $StateRoot -Force|Out-Null
  $d=[ordered]@{schema='TIGERIQ_APP_CHROME_INSTALL_RESULT_V1';result=$result;reason=$reason;exactHead=if($req){[string]$req.exactHead}else{''};artifactId=if($req){[long]$req.artifactId}else{0};issueNumber=if($req){[int]$req.issueNumber}else{0};details=$details;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp=$resultPath+'.tmp';[IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)));Move-Item -Force $tmp $resultPath
}
function Read-RequestFile(){
  if(-not(Test-Path -LiteralPath $requestPath)){return $null}
  $req=Get-Content -Raw -LiteralPath $requestPath|ConvertFrom-Json -ErrorAction Stop
  if([string]$req.schema -ne 'TIGERIQ_APP_CHROME_INSTALL_REQUEST_V1'){throw 'APPCHROME_REQUEST_SCHEMA_INVALID'}
  return $req
}
function Discover-AuthorizedRequest(){
  $issues=(& gh api ('repos/'+$Repo+'/issues?state=open&per_page=100&sort=updated&direction=desc') 2>$null|Out-String)|ConvertFrom-Json -ErrorAction Stop
  foreach($issue in @($issues)){
    if($issue.PSObject.Properties.Name -contains 'pull_request'){continue}
    $body=[string]$issue.body
    if(-not(Exact-Line $body 'OWNER_DIRECT' 'true')){continue}
    if(-not(Exact-Line $body 'APP_CHROME_DEPLOY_AUTHORIZED' 'true')){continue}
    if(-not(Exact-Line $body 'MUTATION_OWNER' 'VY_OWNER_AUTHORIZED')){continue}
    if(-not(Exact-Line $body 'ZERO_TOUCH_DEPLOY' 'true')){continue}
    if(-not(Exact-Line $body 'ZERO_TOUCH_ACTIVATE_SAME_BOOT' 'true')){continue}
    $head=Body-Value $body 'TARGET_HEAD';$artifactId=Body-Value $body 'PACKAGE_ARTIFACT_ID';$artifactName=Body-Value $body 'PACKAGE_ARTIFACT_NAME'
    $nv02Only=(Exact-Line $body 'LIVE_ACCEPTANCE_SCOPE' 'NV02_ONLY') -or (Exact-Line $body 'NV02_ONLY' 'true')
    if($head -notmatch '^[0-9a-f]{40}$'){continue}
    if($artifactId -notmatch '^\d+$'){continue}
    if([string]::IsNullOrWhiteSpace($artifactName)){continue}
    return [pscustomobject]@{schema='TIGERIQ_APP_CHROME_INSTALL_REQUEST_V1';exactHead=$head;artifactId=[long]$artifactId;artifactName=$artifactName;issueNumber=[int]$issue.number;source='GITHUB_OWNER_AUTH';nv02Only=[bool]$nv02Only}
  }
  return $null
}
function Resolve-Request(){
  # Current OPEN Owner+Vy GitHub authorization is authoritative. A stale State
  # request must never block a newer explicit Owner deployment authorization.
  $ownerReq=Discover-AuthorizedRequest
  if($ownerReq){return $ownerReq}
  return Read-RequestFile
}
function Request-Nv02Only($req){
  if($null -eq $req){return $false}
  if($req.PSObject.Properties.Name -contains 'nv02Only'){return [bool]$req.nv02Only}
  return $false
}
function Pause-Nv02OnlySideWriters($req){
  if(-not(Request-Nv02Only $req)){return @()}
  $pausedWorkers=@()
  foreach($id in @('NV03','NV04')){
    $healthUri=$controller+'/api/utility/workers/'+$id+'/health'
    $pauseUri=$controller+'/api/utility/workers/'+$id+'/pause'
    $health=Invoke-RestMethod -Uri $healthUri -TimeoutSec 5
    if(-not [bool]$health.utilityPaused){
      Invoke-RestMethod -Method Post -Uri $pauseUri -TimeoutSec 5|Out-Null
    }
    $after=Invoke-RestMethod -Uri $healthUri -TimeoutSec 5
    if(-not [bool]$after.utilityPaused){throw ('APPCHROME_NV02_ONLY_SIDE_WRITER_PAUSE_FAILED:'+ $id)}
    $pausedWorkers+=$id
  }
  return @($pausedWorkers)
}
function Assert-Authorization($req){
  $issue=(& gh issue view ([int]$req.issueNumber) --repo $Repo --json state,body 2>$null|Out-String)|ConvertFrom-Json -ErrorAction Stop
  if([string]$issue.state -ne 'OPEN'){throw 'APPCHROME_OWNER_ISSUE_NOT_OPEN'}
  $body=[string]$issue.body
  $stateMarker=Body-Value $body 'STATE';$resultMarker=Body-Value $body 'RESULT';$statusMarker=Body-Value $body 'STATUS'
  if(@($stateMarker,$resultMarker,$statusMarker)|Where-Object{$_ -match '^(CLOSED|REVOKED|SUPERSEDED|CANCELLED|CANCELED)$'}){throw 'APPCHROME_OWNER_AUTH_SUPERSEDED'}
  foreach($key in @('APP_CHROME_DEPLOY_REVOKED','ZERO_TOUCH_REVOKED','DEPLOY_REVOKED','AUTH_REVOKED')){if((Body-Value $body $key) -eq 'true'){throw 'APPCHROME_OWNER_AUTH_REVOKED'}}
  if(-not(Exact-Line $body 'OWNER_DIRECT' 'true')){throw 'APPCHROME_OWNER_DIRECT_MISSING'}
  if(-not(Exact-Line $body 'APP_CHROME_DEPLOY_AUTHORIZED' 'true')){throw 'APPCHROME_DEPLOY_AUTH_MISSING'}
  if(-not(Exact-Line $body 'MUTATION_OWNER' 'VY_OWNER_AUTHORIZED')){throw 'APPCHROME_MUTATION_OWNER_INVALID'}
  if(-not(Exact-Line $body 'ZERO_TOUCH_DEPLOY' 'true')){throw 'APPCHROME_ZERO_TOUCH_AUTH_MISSING'}
  if(-not(Exact-Line $body 'ZERO_TOUCH_ACTIVATE_SAME_BOOT' 'true')){throw 'APPCHROME_SAME_BOOT_AUTH_MISSING'}
  if((Body-Value $body 'TARGET_HEAD') -ne [string]$req.exactHead){throw 'APPCHROME_AUTH_HEAD_MISMATCH'}
  if((Body-Value $body 'PACKAGE_ARTIFACT_ID') -ne [string]$req.artifactId){throw 'APPCHROME_AUTH_ARTIFACT_ID_MISMATCH'}
  $authName=Body-Value $body 'PACKAGE_ARTIFACT_NAME';if($authName -and $authName -ne [string]$req.artifactName){throw 'APPCHROME_AUTH_ARTIFACT_NAME_MISMATCH'}
  if((Request-Nv02Only $req) -and -not((Exact-Line $body 'LIVE_ACCEPTANCE_SCOPE' 'NV02_ONLY') -or (Exact-Line $body 'NV02_ONLY' 'true'))){throw 'APPCHROME_NV02_ONLY_AUTH_MISSING'}
}
function Gates-Pass([string]$sha){
  $runs=(& gh api ('repos/'+$Repo+'/actions/runs?head_sha='+$sha+'&status=completed&per_page=50') 2>$null|Out-String)|ConvertFrom-Json -ErrorAction Stop
  foreach($name in @('CI','WO-014 Queue Hygiene','WO-012/013 Vercel Online Verify')){
    if(-not @($runs.workflow_runs|Where-Object{$_.name -eq $name -and $_.conclusion -eq 'success'})){throw ('APPCHROME_REQUIRED_GATE_MISSING:'+ $name)}
  }
}
function Verify-Artifact($req){
  $artifact=(& gh api ('repos/'+$Repo+'/actions/artifacts/'+[long]$req.artifactId) 2>$null|Out-String)|ConvertFrom-Json -ErrorAction Stop
  if([string]$artifact.name -ne [string]$req.artifactName){throw 'APPCHROME_ARTIFACT_NAME_MISMATCH'}
  if([bool]$artifact.expired){throw 'APPCHROME_ARTIFACT_EXPIRED'}
  $runId=[long]$artifact.workflow_run.id;if(-not $runId){throw 'APPCHROME_ARTIFACT_RUN_MISSING'}
  $run=(& gh api ('repos/'+$Repo+'/actions/runs/'+$runId) 2>$null|Out-String)|ConvertFrom-Json -ErrorAction Stop
  if([string]$run.name -ne 'Chrome Controller Package'){throw 'APPCHROME_ARTIFACT_WORKFLOW_INVALID'}
  if([string]$run.conclusion -ne 'success'){throw 'APPCHROME_ARTIFACT_RUN_NOT_SUCCESS'}
  if([string]$run.head_sha -ne [string]$req.exactHead){throw 'APPCHROME_ARTIFACT_HEAD_MISMATCH'}
  Gates-Pass ([string]$req.exactHead)
  return [pscustomobject]@{runId=$runId}
}
function Worker-Busy($state){
  foreach($w in @($state.workers)){
    if([string]$w.status -eq 'WORKING'){return $true}
    if($w.lastHeartbeat -and ([bool]$w.lastHeartbeat.uiBusy -or [bool]$w.lastHeartbeat.stopVisible)){return $true}
  }
  return $false
}
function Test-AppChromeColdBoundary(){
  foreach($port in @(8798,8799,8800,9222,9223,9224,8823)){
    if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){return $false}
  }
  return $true
}
function Wait-SafeBoundary([int]$timeoutSec=600){
  $deadline=(Get-Date).AddSeconds($timeoutSec)
  while((Get-Date)-lt$deadline){
    try{
      $before=Invoke-RestMethod -Uri ($controller+'/api/state') -TimeoutSec 5
      if(Worker-Busy $before){Start-Sleep -Seconds 3;continue}
      Invoke-RestMethod -Method Post -Uri ($controller+'/api/pause') -TimeoutSec 5|Out-Null
      Start-Sleep -Milliseconds 500
      $locked=Invoke-RestMethod -Uri ($controller+'/api/state') -TimeoutSec 5
      if(-not(Worker-Busy $locked)){return [pscustomobject]@{mode='LIVE_PAUSED';paused=$true;state=$locked}}
      Invoke-RestMethod -Method Post -Uri ($controller+'/api/resume') -TimeoutSec 5|Out-Null
    }catch{
      if(Test-AppChromeColdBoundary){return [pscustomobject]@{mode='COLD_START';paused=$false;state=$null}}
    }
    Start-Sleep -Seconds 3
  }
  throw 'APPCHROME_SAFE_BOUNDARY_TIMEOUT'
}
function False-Property($obj,[string]$name){
  if($null -eq $obj){return $true}
  if($obj.PSObject.Properties.Name -notcontains $name){return $true}
  return -not [bool]$obj.$name
}
function Wait-ExactHead([string]$head,[int]$timeoutSec=150){
  $deadline=(Get-Date).AddSeconds($timeoutSec)
  while((Get-Date)-lt$deadline){
    try{
      $state=Invoke-RestMethod -Uri ($controller+'/api/state') -TimeoutSec 5
      $bh=Invoke-RestMethod -Uri ($bridge+'/health') -TimeoutSec 5
      $extOff=(False-Property $state 'externalWorkAutopilotEnabled') -and (False-Property $state 'externalWorkAutopilot')
      $selfOff=($null -eq $state.selfRun) -or (-not [bool]$state.selfRun.enabled)
      $gitOff=($null -eq $state.githubSelfRun) -or (-not [bool]$state.githubSelfRun.enabled)
      if([string]$state.runtimeProvenance.approvedHead -eq $head -and [string]$bh.approvedHead -eq $head -and [bool]$bh.provenanceVerified -and $extOff -and $selfOff -and $gitOff){return [pscustomobject]@{state=$state;bridge=$bh}}
    }catch{}
    Start-Sleep -Seconds 2
  }
  throw 'APPCHROME_EXACT_HEAD_HEALTH_TIMEOUT'
}
function Restore-File([string]$backup,[string]$target){if(Test-Path -LiteralPath $backup){Copy-Item -LiteralPath $backup -Destination $target -Force}}

function Request-Fingerprint($req){
  return @([string]$req.schema,[string]$req.exactHead.ToLowerInvariant(),[string][long]$req.artifactId,[string]$req.artifactName,[string][int]$req.issueNumber,('NV02_ONLY='+[string][bool](Request-Nv02Only $req))) -join '|'
}
function Revalidate-After-SafeBoundary($req,[string]$fingerprint,[long]$verifiedRunId){
  $fresh=Resolve-Request
  if($null -eq $fresh){throw 'APPCHROME_ZERO_TOUCH_AUTH_REVOKED_DURING_WAIT'}
  if((Request-Fingerprint $fresh) -ne $fingerprint){throw 'APPCHROME_ZERO_TOUCH_REQUEST_CHANGED_DURING_WAIT'}
  Assert-Authorization $fresh
  $freshVerified=Verify-Artifact $fresh
  if([long]$freshVerified.runId -ne $verifiedRunId){throw 'APPCHROME_ZERO_TOUCH_ARTIFACT_CHANGED_DURING_WAIT'}
  return [pscustomobject]@{request=$fresh;verified=$freshVerified}
}
$req=$null;$paused=$false;$rollback=$null
try{
  New-Item -ItemType Directory -Path $StateRoot -Force|Out-Null
  $req=Resolve-Request
  if($null -eq $req){[pscustomobject]@{action='none';reason='request_absent'}|ConvertTo-Json -Compress;Release-SingleFlight;exit 0}
  if([string]$req.exactHead -notmatch '^[0-9a-f]{40}$'){throw 'APPCHROME_REQUEST_HEAD_INVALID'}
  if([long]$req.artifactId -le 0){throw 'APPCHROME_REQUEST_ARTIFACT_INVALID'}
  if([int]$req.issueNumber -le 0){throw 'APPCHROME_REQUEST_ISSUE_INVALID'}
  $prior=$null;try{if(Test-Path -LiteralPath $resultPath){$prior=Get-Content -Raw -LiteralPath $resultPath|ConvertFrom-Json}}catch{}
  # A durable PASS receipt is evidence of a previous install, not proof that the
  # runtime is alive after reboot. Always revalidate authorization/artifact and
  # live provenance before deciding no install is required.
  Assert-Authorization $req
  $verified=Verify-Artifact $req
  try{
    $alreadyLive=Wait-ExactHead ([string]$req.exactHead) 5
    if($alreadyLive){
      try{Invoke-RestMethod -Method Post -Uri ($controller+'/api/resume') -TimeoutSec 5|Out-Null}catch{}
      $details=[ordered]@{runId=[long]$verified.runId;deploy=[string]$alreadyLive.state.runtimeProvenance.deployRoot;bridgeSha256=[string]$alreadyLive.bridge.sourceSha256;provenanceVerified=[bool]$alreadyLive.bridge.provenanceVerified;nv02WakeStatus='NOT_REQUIRED_ALREADY_LIVE';preQuiescedWorkers=@();requestSource=if($req.PSObject.Properties.Name -contains 'source'){$req.source}else{'STATE_FILE'}}
      Save-Result 'PASS' 'APPCHROME_ALREADY_LIVE_EXACT_HEAD' $req $details
      $comment=@('APP_CHROME_ZERO_TOUCH_INSTALL=PASS',('TARGET_HEAD='+[string]$req.exactHead),('ARTIFACT_ID='+[string]$req.artifactId),('RUN_ID='+[string]$verified.runId),'REASON=APPCHROME_ALREADY_LIVE_EXACT_HEAD',('PROVENANCE_VERIFIED='+[string][bool]$alreadyLive.bridge.provenanceVerified),('DEPLOY_ROOT='+[string]$alreadyLive.state.runtimeProvenance.deployRoot),'RDC_USED=false') -join [Environment]::NewLine
      & gh issue comment ([int]$req.issueNumber) --repo $Repo --body $comment 2>$null|Out-Null
      [pscustomobject]@{action='none';reason='already_live_exact_head';result='PASS';exactHead=[string]$req.exactHead;artifactId=[long]$req.artifactId;issueNumber=[int]$req.issueNumber;runId=[long]$verified.runId}|ConvertTo-Json -Compress
      Release-SingleFlight
      exit 0
    }
  }catch{}
  $requestFingerprint=Request-Fingerprint $req
  $stage=Join-Path $stageRoot (([string]$req.exactHead).Substring(0,7)+'-'+[string]$req.artifactId)
  $rollback=Join-Path $stage 'rollback'
  if(Test-Path -LiteralPath $stage){Remove-Item -Recurse -Force -LiteralPath $stage}
  New-Item -ItemType Directory -Force -Path $stage|Out-Null
  & gh run download ([long]$verified.runId) --repo $Repo --name ([string]$req.artifactName) --dir $stage 2>$null
  if($LASTEXITCODE -ne 0){throw 'APPCHROME_ARTIFACT_DOWNLOAD_FAILED'}
  $artifactRoot=$stage
  if(-not(Test-Path -LiteralPath (Join-Path $artifactRoot 'VERSION.txt'))){
    $nested=Join-Path $stage 'TigerIQ-Chrome-Controller-V1';if(Test-Path -LiteralPath (Join-Path $nested 'VERSION.txt')){$artifactRoot=$nested}
  }
  $version=Join-Path $artifactRoot 'VERSION.txt';if(-not(Test-Path -LiteralPath $version)){throw 'APPCHROME_DOWNLOADED_VERSION_MISSING'}
  if((Get-Content -Raw -LiteralPath $version).Trim() -ne [string]$req.exactHead){throw 'APPCHROME_DOWNLOADED_HEAD_MISMATCH'}
  $installer=Join-Path $artifactRoot 'apps\chrome-controller\runtime\Install-ApprovedArtifact.ps1';if(-not(Test-Path -LiteralPath $installer)){throw 'APPCHROME_CANONICAL_INSTALLER_MISSING'}
  $runtime=Join-Path $InstallRoot 'Runtime';$active=Join-Path $runtime 'active-deploy.json';$pending=Join-Path $runtime 'pending-deploy.json';$launcher=Join-Path $runtime 'Start-Unified-AppChrome.ps1';$legacy=Join-Path $runtime 'Start-Unified-AppChrome-1372.ps1'
  $preQuiescedWorkers=@(Pause-Nv02OnlySideWriters $req)
  $boundary=Wait-SafeBoundary
  $paused=[bool]$boundary.paused
  $revalidated=Revalidate-After-SafeBoundary $req $requestFingerprint ([long]$verified.runId)
  $req=$revalidated.request;$verified=$revalidated.verified
  New-Item -ItemType Directory -Force -Path $rollback|Out-Null
  if(Test-Path -LiteralPath $active){Copy-Item $active (Join-Path $rollback 'active-deploy.json') -Force}
  if(Test-Path -LiteralPath $pending){Copy-Item $pending (Join-Path $rollback 'pending-deploy.json') -Force}
  if(Test-Path -LiteralPath $launcher){Copy-Item $launcher (Join-Path $rollback 'Start-Unified-AppChrome.ps1') -Force}
  if(Test-Path -LiteralPath $legacy){Copy-Item $legacy (Join-Path $rollback 'Start-Unified-AppChrome-1372.ps1') -Force}
  $installerArgs=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$installer,'-ExpectedHead',([string]$req.exactHead),'-ArtifactRoot',$artifactRoot,'-ActivateNow')
  if(Request-Nv02Only $req){$installerArgs+='-Nv02Only'}
  & powershell.exe @installerArgs
  if($LASTEXITCODE -ne 0){throw 'APPCHROME_CANONICAL_INSTALLER_FAILED'}
  $taskName='TigerIQ APP Chrome Unified'
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if(-not $task){throw 'APPCHROME_UNIFIED_TASK_MISSING'}
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $live=Wait-ExactHead ([string]$req.exactHead)
  try{Invoke-RestMethod -Method Post -Uri ($controller+'/api/resume') -TimeoutSec 5|Out-Null}catch{};$paused=$false
  $wakeStatus='NOT_ATTEMPTED'
  # The NV02 resume endpoint can synchronously wait through up to three
  # controller command attempts (60s each + retry gaps). Keep the client
  # timeout above that bounded server budget so a healthy wake is not
  # misclassified as WebException and rolled back.
  $nv02ResumeRequestTimeoutSec=210
  $nv02WakeDeadlineSec=240
  $wakeDeadline=(Get-Date).AddSeconds($nv02WakeDeadlineSec)
  while((Get-Date)-lt$wakeDeadline){
    try{
      $wake=Invoke-RestMethod -Method Post -Uri ($controller+'/api/utility/workers/NV02/resume') -TimeoutSec $nv02ResumeRequestTimeoutSec
      $wakeStatus=[string]$wake.status
      if($wakeStatus -in @('NV02_IDLE_CONTINUE_WAKE_SUBMITTED','LOCAL_CONTINUE_SUBMITTED','ALREADY_WORKING')){break}
    }catch{$wakeStatus='RETRY:'+[string]$_.Exception.GetType().Name}
    Start-Sleep -Seconds 3
  }
  if($wakeStatus -notin @('NV02_IDLE_CONTINUE_WAKE_SUBMITTED','LOCAL_CONTINUE_SUBMITTED','ALREADY_WORKING')){throw ('APPCHROME_NV02_WAKE_TIMEOUT:'+ $wakeStatus)}
  $details=[ordered]@{runId=[long]$verified.runId;deploy=[string]$live.state.runtimeProvenance.deployRoot;bridgeSha256=[string]$live.bridge.sourceSha256;provenanceVerified=[bool]$live.bridge.provenanceVerified;nv02WakeStatus=$wakeStatus;preQuiescedWorkers=@($preQuiescedWorkers);safeBoundaryMode=[string]$boundary.mode;requestSource=if($req.PSObject.Properties.Name -contains 'source'){$req.source}else{'STATE_FILE'}}
  Save-Result 'PASS' 'APPCHROME_EXACT_HEAD_LIVE' $req $details
  $comment=@('APP_CHROME_ZERO_TOUCH_INSTALL=PASS',('TARGET_HEAD='+[string]$req.exactHead),('ARTIFACT_ID='+[string]$req.artifactId),('RUN_ID='+[string]$verified.runId),('PROVENANCE_VERIFIED='+[string][bool]$live.bridge.provenanceVerified),('NV02_WAKE_STATUS='+$wakeStatus),('DEPLOY_ROOT='+[string]$live.state.runtimeProvenance.deployRoot),'RDC_USED=false') -join [Environment]::NewLine
  & gh issue comment ([int]$req.issueNumber) --repo $Repo --body $comment 2>$null|Out-Null
  [pscustomobject]@{action='installed';result='PASS';exactHead=[string]$req.exactHead;artifactId=[long]$req.artifactId;issueNumber=[int]$req.issueNumber;runId=[long]$verified.runId}|ConvertTo-Json -Compress
  Release-SingleFlight
  exit 0
}catch{
  $reason=$_.Exception.Message
  try{
    if($rollback){
      $runtime=Join-Path $InstallRoot 'Runtime'
      $activeTarget=Join-Path $runtime 'active-deploy.json';$pendingTarget=Join-Path $runtime 'pending-deploy.json'
      Restore-File (Join-Path $rollback 'active-deploy.json') $activeTarget
      if(Test-Path -LiteralPath (Join-Path $rollback 'pending-deploy.json')){Restore-File (Join-Path $rollback 'pending-deploy.json') $pendingTarget}else{Remove-Item -LiteralPath $pendingTarget -Force -ErrorAction SilentlyContinue}
      Restore-File (Join-Path $rollback 'Start-Unified-AppChrome.ps1') (Join-Path $runtime 'Start-Unified-AppChrome.ps1');Restore-File (Join-Path $rollback 'Start-Unified-AppChrome-1372.ps1') (Join-Path $runtime 'Start-Unified-AppChrome-1372.ps1')
      $task=Get-ScheduledTask -TaskName 'TigerIQ APP Chrome Unified' -ErrorAction SilentlyContinue;if($task){Stop-ScheduledTask -TaskName 'TigerIQ APP Chrome Unified' -ErrorAction SilentlyContinue;Start-ScheduledTask -TaskName 'TigerIQ APP Chrome Unified' -ErrorAction SilentlyContinue}
    }
  }catch{}
  if($paused){try{Invoke-RestMethod -Method Post -Uri ($controller+'/api/resume') -TimeoutSec 5|Out-Null}catch{}}
  Save-Result 'BLOCKED' $reason $req
  if($req){$comment=@('APP_CHROME_ZERO_TOUCH_INSTALL=BLOCKED',('TARGET_HEAD='+[string]$req.exactHead),('ARTIFACT_ID='+[string]$req.artifactId),('REASON='+$reason),'RDC_USED=false') -join [Environment]::NewLine;& gh issue comment ([int]$req.issueNumber) --repo $Repo --body $comment 2>$null|Out-Null}
  [pscustomobject]@{action='blocked';result='BLOCKED';reason=$reason}|ConvertTo-Json -Compress
  Release-SingleFlight
  exit 1
}
