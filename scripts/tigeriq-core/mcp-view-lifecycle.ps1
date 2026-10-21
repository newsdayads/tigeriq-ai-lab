# Scoped MCP API Health View Gateway lifecycle. Loaded only by the signed runtime updater.
# No credentials, permissions, or new Scheduled Tasks are created here.
$apiHealthViewTask='TigerIQ API Health View Gateway'
$apiHealthViewEntry=(Join-Path $runtimeRepo 'apps\tigeriq-core\api-health-view-gateway.mjs').ToLowerInvariant()
$apiHealthViewAppliedState='D:\TigerIQ\State\api-health-view-applied.json'

function Restart-ApiHealthViewGateway(){
  # Static ESM imports in the separate MCP process do not reload after source updates.
  if(-not(Task-Exists $apiHealthViewTask)){throw 'MCP_VIEW_TASK_MISSING'}
  $matching=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop | Where-Object {
    $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($apiHealthViewEntry)
  })
  if($matching.Count -gt 1){throw 'MCP_VIEW_PROCESS_AMBIGUOUS'}
  $oldPid=if($matching.Count -eq 1){[int]$matching[0].ProcessId}else{$null}
  if(-not $oldPid){
    try{$oldHealth=Invoke-RestMethod -Uri 'http://127.0.0.1:8802/mcp/health' -TimeoutSec 3 -ErrorAction Stop}catch{$oldHealth=$null}
    if($oldHealth -and $oldHealth.ok -eq $true){throw 'MCP_VIEW_LISTENER_UNOWNED'}
  }
  Stop-ScheduledTask -TaskName $apiHealthViewTask -ErrorAction Stop
  if($oldPid){Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue}
  $stopDeadline=(Get-Date).AddSeconds(15)
  while($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)){
    if((Get-Date)-ge$stopDeadline){throw 'MCP_VIEW_OLD_PID_STILL_RUNNING'}
    Start-Sleep -Milliseconds 500
  }
  Start-ScheduledTask -TaskName $apiHealthViewTask -ErrorAction Stop
  $deadline=(Get-Date).AddSeconds(60)
  while((Get-Date)-lt$deadline){
    $newPid=Get-NodePidByMatch $apiHealthViewEntry
    $health=$null
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:8802/mcp/health' -TimeoutSec 3 -ErrorAction Stop}catch{}
    if($newPid -and (($null-eq$oldPid)-or([int]$newPid-ne[int]$oldPid)) -and
       $health -and $health.ok -eq $true -and [string]$health.service -eq 'TigerIQ PC Operator MCP Server' -and
       $null-ne$health.uptimeSec -and [double]$health.uptimeSec -ge 0 -and [double]$health.uptimeSec -lt 65){
      return @{pid=[int]$newPid;previousPid=$oldPid;uptimeSec=[double]$health.uptimeSec;verified=$true}
    }
    Start-Sleep -Seconds 2
  }
  throw 'MCP_VIEW_NEW_PID_AND_HEALTH_NOT_VERIFIED'
}
function Save-ApiHealthViewAppliedState([string]$sha,$receipt){
  $result=[ordered]@{schema='TIGERIQ_MCP_VIEW_APPLIED_V1';installedSha=$sha;pid=$receipt.pid;previousPid=$receipt.previousPid;uptimeSec=$receipt.uptimeSec;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp=$apiHealthViewAppliedState+'.tmp'
  [IO.File]::WriteAllText($tmp,($result|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
  Move-Item -Force $tmp $apiHealthViewAppliedState
}
function Reconcile-ApiHealthViewSelfUpdate([string]$sha){
  # The *old* updater executes the first release; this code first runs on its next NO_CHANGE loop.
  if(-not $sha -or -not(Test-Path -LiteralPath $state)){return @{action='skip';reason='missing_state'}}
  try{
    if(Test-Path -LiteralPath $apiHealthViewAppliedState){
      $applied=Get-Content -Raw -LiteralPath $apiHealthViewAppliedState|ConvertFrom-Json -ErrorAction Stop
      if([string]$applied.installedSha -eq $sha){return @{action='none';reason='already_applied'}}
    }
    $prior=Get-Content -Raw -LiteralPath $state|ConvertFrom-Json -ErrorAction Stop
    if([string]$prior.result -ne 'UPDATED' -or [string]$prior.installedSha -ne $sha -or
       -not (@($prior.changedPaths) -contains 'scripts/tigeriq-core/update-core-runtime.ps1')){
      return @{action='skip';reason='no_self_update_receipt'}
    }
    $release=Get-Content -Raw -LiteralPath 'C:\ProgramData\TigerIQCoreRelease\core-runtime-release-attempt.json'|ConvertFrom-Json -ErrorAction Stop
    $source=Get-Content -Raw -LiteralPath $runtimeSourceState|ConvertFrom-Json -ErrorAction Stop
    if([string]$release.result -ne 'COMMITTED' -or [string]$release.targetSha -ne $sha -or
       [string]$source.currentSha -ne $sha){return @{action='blocked';reason='release_receipt_mismatch'}}
    $receipt=Restart-ApiHealthViewGateway
    Save-ApiHealthViewAppliedState $sha $receipt
    return @{action='restarted';pid=$receipt.pid;previousPid=$receipt.previousPid;uptimeSec=$receipt.uptimeSec}
  }catch{return @{action='blocked';reason='MCP_VIEW_SELF_UPDATE_RECONCILE_FAILED';error=$_.Exception.Message}}
}

function Invoke-McpViewRelease([string[]]$changed,[string]$sha){
  $targets=@(
    'apps/tigeriq-core/api-health-view-gateway.mjs',
    'apps/tigeriq-core/pc-operator-mcp.mjs',
    'apps/openclaw-tigeriq-runtime/operator.mjs',
    'apps/openclaw-tigeriq-runtime/paperclip-lab.mjs',
    'scripts/tigeriq-core/update-core-runtime.ps1',
    'scripts/tigeriq-core/mcp-view-lifecycle.ps1'
  )
  if(-not(@($changed | Where-Object{$_ -in $targets}).Count)){return $false}
  $script:mcpViewChanged=$true
  $script:mcpViewReceipt=Restart-ApiHealthViewGateway
  return $true
}
