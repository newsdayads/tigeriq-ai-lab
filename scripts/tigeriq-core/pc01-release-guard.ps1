# Operational gate sourced only from installed runtime, never candidate or GitHub metadata.
$releaseApprovalPath='C:\ProgramData\TigerIQCoreRelease\core-runtime-release-approval.json'
$releaseAttemptPath='C:\ProgramData\TigerIQCoreRelease\core-runtime-release-attempt.json'
function Test-ReleaseApprovalAcl {
  # The parent directory matters: an untrusted directory writer can replace
  # a correctly ACL-protected child with a forged approval file.
  $trusted=@('S-1-5-18','S-1-5-32-544') # SYSTEM and BUILTIN\Administrators only
  $writeMask=[System.Security.AccessControl.FileSystemRights]::Write -bor
             [System.Security.AccessControl.FileSystemRights]::Modify -bor
             [System.Security.AccessControl.FileSystemRights]::FullControl -bor
             [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
             [System.Security.AccessControl.FileSystemRights]::TakeOwnership -bor
             [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
  try{
    if(-not [Environment]::OSVersion.Platform.ToString().Equals('Win32NT')){return $false}
    if(-not(Test-Path -LiteralPath $releaseApprovalPath -PathType Leaf)){return $false}
    $parent=Split-Path -Parent $releaseApprovalPath
    foreach($path in @($parent,$releaseApprovalPath)){
      $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){return $false}
      $acl=Get-Acl -LiteralPath $path -ErrorAction Stop
      $owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
      if($owner -notin $trusted){return $false}
      foreach($ace in @($acl.Access)){
        if([string]$ace.AccessControlType -ne 'Allow'){continue}
        $sid=$ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if($sid -notin $trusted -and ($ace.FileSystemRights -band $writeMask) -ne 0){return $false}
      }
    }
    return $true
  }catch{return $false}
}
function Assert-ReleaseChangedPaths([string[]]$changedPaths,[hashtable]$impact){
  if(-not $changedPaths -or @($changedPaths).Count -eq 0){return 'RELEASE_CHANGED_PATHS_MISSING'}
  $sourceOnly=@('docs/PC01_GATED_RELEASE_PHASE1.md','vitest.config.ts','tests/pc01-release-guard-e2e.test.mjs','tests/pc01-release-preflight.test.mjs','tests/pc01-updater-release-gate.test.mjs','.github/ISSUE_TEMPLATE/work_order_v2.md','scripts/verify_work_board_ui.mjs','tests/continuous-capability-verify.test.mjs','tests/core-autonomous-rca.test.ts','tests/core-manager-stop-next.test.mjs','tests/github-intake.test.mjs','tests/live-status-api.test.mjs','tests/tigeriq-live-owner-refinement.test.mjs','tests/web-control.test.ts','tests/work-order-lifecycle-v2.test.mjs')
  foreach($path in $changedPaths){
    # The single Core-owned API module is executable: component gate required.
    if($path -ceq 'api/live-status.mjs'){
      if(-not $impact.core){return 'RELEASE_PATH_COMPONENT_MISMATCH'}
      continue
    }
    if(-not $path -or $path -match '(?i)(app.?chrome|android|secrets|credentials|\.env|vercel\.json|^api/)'){return 'RELEASE_PATH_OUT_OF_SCOPE'}
    if($path -in $sourceOnly){continue}
    if($path -in @('scripts/tigeriq-core/update-core-runtime.ps1','scripts/tigeriq-core/pc01-release-guard.ps1','scripts/tigeriq-core/pc01-release-preflight.mjs','scripts/tigeriq-core/bootstrap-watchdog.ps1','scripts/tigeriq-core/install-core-updater.ps1')){
      if(-not $impact.updater){return 'RELEASE_PATH_COMPONENT_MISMATCH'}
      continue
    }
    if($path -match '^apps/openclaw-tigeriq-runtime/'){
      if(-not $impact.openclaw){return 'RELEASE_PATH_COMPONENT_MISMATCH'}
      continue
    }
    if($path -match '^apps/tigeriq-core/' -and $path -notmatch '^apps/tigeriq-core/(web-control|owner-facing-vietnamese)'){
      if(-not $impact.core){return 'RELEASE_PATH_COMPONENT_MISMATCH'}
      continue
    }
    if($path -in @('scripts/tigeriq-core/run-core.ps1','scripts/tigeriq-core/install-core-task.ps1')){
      if(-not $impact.core){return 'RELEASE_PATH_COMPONENT_MISMATCH'}
      continue
    }
    return 'RELEASE_PATH_OUT_OF_SCOPE'
  }
  return $null
}
function Get-ReleaseApproval([string]$targetSha,[string]$installedSha,[hashtable]$impact,[string[]]$changedPaths){
  # The local file is an operational approval record, not cryptographic proof
  # of Owner identity. An independently authorized local procedure MUST provision it.
  if($targetSha -notmatch '^[a-f0-9]{40}$' -or $installedSha -notmatch '^[a-f0-9]{40}$'){return @{approved=$false;reason='RELEASE_BASELINE_UNVERIFIED'}}
  if(-not(Test-Path -LiteralPath $releaseApprovalPath)){return @{approved=$false;reason='RELEASE_LOCAL_APPROVAL_MISSING'}}
  if(-not(Test-ReleaseApprovalAcl)){return @{approved=$false;reason='RELEASE_APPROVAL_ACL_UNTRUSTED'}}
  try{
    $a=Get-Content -Raw -LiteralPath $releaseApprovalPath|ConvertFrom-Json -ErrorAction Stop
    if([string]$a.schema -ne 'TIGERIQ_PC01_RELEASE_APPROVAL_V1'){return @{approved=$false;reason='RELEASE_APPROVAL_SCHEMA_INVALID'}}
    if([string]$a.scope -ne 'TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1'){return @{approved=$false;reason='RELEASE_APPROVAL_SCOPE_INVALID'}}
    if([string]$a.targetSha -cne $targetSha){return @{approved=$false;reason='RELEASE_TARGET_MISMATCH'}}
    if([string]$a.expectedInstalledSha -cne $installedSha -or [string]$a.rollbackSha -cne $installedSha){return @{approved=$false;reason='RELEASE_BASELINE_MISMATCH'}}
    if([string]$a.requestId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{3,119}$'){return @{approved=$false;reason='RELEASE_REQUEST_ID_INVALID'}}
    if($a.approved -cne $true){return @{approved=$false;reason='RELEASE_NOT_APPROVED'}}
    $expiry=[DateTime]::Parse([string]$a.expiresAtUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    $now=(Get-Date).ToUniversalTime()
    if($expiry -le $now -or $expiry -gt $now.AddDays(7)){return @{approved=$false;reason='RELEASE_APPROVAL_EXPIRED_OR_TOO_LONG'}}
    if($impact.web -or $impact.coding -or $impact.liveBridge){return @{approved=$false;reason='RELEASE_IMPACT_OUT_OF_SCOPE'}}
    $pathDenial=Assert-ReleaseChangedPaths $changedPaths $impact
    if($pathDenial){return @{approved=$false;reason=$pathDenial}}
    if(-not($impact.core -or $impact.openclaw -or $impact.updater)){return @{approved=$false;reason='RELEASE_NO_APPROVED_COMPONENT_IMPACT'}}
    $wanted=@(@('core','openclaw','updater')|Where-Object{$impact[$_] }|Sort-Object)
    $provided=@($a.components|ForEach-Object{[string]$_}|Sort-Object)
    if(($provided -join ',') -cne ($wanted -join ',')){return @{approved=$false;reason='RELEASE_COMPONENTS_MISMATCH'}}
    if(Test-Path -LiteralPath $releaseAttemptPath){
      $previous=Get-Content -Raw -LiteralPath $releaseAttemptPath|ConvertFrom-Json -ErrorAction Stop
      if([string]$previous.requestId -ceq [string]$a.requestId -or [string]$previous.targetSha -ceq $targetSha){return @{approved=$false;reason='RELEASE_ATTEMPT_ALREADY_RECORDED'}}
    }
    return @{approved=$true;reason='LOCAL_RELEASE_APPROVAL_PRESENT';requestId=[string]$a.requestId}
  }catch{return @{approved=$false;reason='RELEASE_LOCAL_APPROVAL_INVALID'}}
}
function Save-ReleaseAttempt([string]$requestId,[string]$targetSha,[string]$previousSha,[string]$result){
  $d=[ordered]@{schema='TIGERIQ_PC01_RELEASE_ATTEMPT_V1';requestId=$requestId;targetSha=$targetSha;previousSha=$previousSha;result=$result;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}
  $tmp=$releaseAttemptPath+'.tmp'
  [IO.File]::WriteAllText($tmp,($d|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
  Move-Item -Force -LiteralPath $tmp -Destination $releaseAttemptPath
}
