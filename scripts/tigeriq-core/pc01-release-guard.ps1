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
# One-time P0 Owner authorization is bound to exact Git object content from merged PR #4746.
# The manifest does not grant permission or replace a separately signed release ticket.
$ownerOneTapBlobs=@{
  'apps/shared/owner-one-tap-approval.mjs'='0443422cd188f41c7fd172184b4f4e7281bb2acb'
  'apps/tigeriq-core/web-control-server.mjs'='fcc90b3a36f760dec4482689b01db26bbee20b98'
  'apps/tigeriq-core/web-control.html'='02db28746fac9a50db20b285d920821658d78ba7'
  'docs/OWNER_ONE_TAP_APPROVAL_V1.md'='6da62bae2baf67c84b0379d59a7b970e6d2082d5'
  'scripts/tigeriq-core/run-web-control-bundle.ps1'='ebe81cf08e073b1f04c4c64aa31685aa3bf66772'
  'tests/owner-one-tap-approval.test.mjs'='a4d4c1ba4f7157e86b36f85cbbb29c8a01bfe3e9'
  'tests/web-control-bundle-assets.test.mjs'='b16bb88ac0614c8848876549e815d87a9fbb8065'
  'vitest.config.ts'='8d4d66e9aeeac9e54545b38165fe4e46cc5743f2'
}
# Scoped Owner-authorized API Health :8795 CSS and test bundle, exact Git blobs only.
# Does not bypass the distinct signed GitHub/OIDC release event or ACL gate.
$ownerApiHealthBlobs=@{
  'public/work-center-visual.css'='d55a81c101b7f995cb71d6cbc3b3eb772c06e4f5'
  'scripts/verify_work_board_ui.mjs'='90ec17f4a021aa2d20942932916af138c095e2fc'
  'tests/e2e/api-health-work-card-layout.spec.ts'='a4c126d8b2dec8515332ca0366de5eb048f9e613'
}
# Owner-authorized #280 Coding Lane manager failover: ONLY the two exact immutable Git blobs.
# Distinct signed GitHub/OIDC approval, ACL, anti-replay and rollback stay mandatory.
$ownerCodingContractBlobs=@{
  'apps/tigeriq-coding-lane/coding-lane.mjs'='ae42ee5bdfd9065dd103f782140ec6330c42dce6'
  'tests/coding-lane-foundation.test.mjs'='20aff7451494d107f0629ba69c220d3516a76899'
}
# Exact immutable Owner V6 #4761 source-bundle combined with signed P0 #4763
# No pattern-wide permission. No replacement for Owner OIDC and SYSTEM ACL.
$ownerV6Blobs=@{
  'bootstrap/00_TIGERIQ_LOADER.md'='0dfdc8d0ad7046f97d80e3467366c9e33484c384'
  'tests/e2e/api-health-visual-regression.spec.ts'='215d836a576e2bbeea0377d42f9fbbe8e789c88f'
  'apps/dashboard/src/bcct.mjs'='ff3d4a23fd9df2e46773e34f092131e948458fec'
  'apps/shared/owner-interaction-v6.mjs'='a11454a5dd14a651d79bd1149fef70d8f5f2f109'
  'bootstrap/02_TIGERIQ_WORKFLOW.md'='161991bc203669189ed027789972104e0d83fa34'
  'docs/OWNER_CHAT_REPORT_VISUAL_V3.md'='b424bb342cd87c64273ba2c09b8671ac1098a2e3'
  'docs/OWNER_INTERACTION_V6.md'='1e116588234452574c2fc55db82a895e8ef311a8'
  'public/work-center.js'='805ac2ec5af164b4bba54dd050c388ee9684ecac'
  'public/work-ui.css'='7d3154d490dbcd2ce4f59e860ffd32da054a45ad'
  'scripts/package-bcct-runtime.mjs'='aab7b48a09860144e15684608c548b8bce5253b4'
  'tests/bcct-renderer.test.mjs'='61075fe03d776f0363951774ae6771cf2ad7a104'
  'tests/owner-interaction-v6.test.mjs'='6486b3ea5f6677639a79de8733320c49f8d1c51e'
  'tests/owner-v6-work-center-colors.test.mjs'='c1ce618ab1c84c14d1c913658856ee0a2000cf26'
}
$ownerOneTapWebPaths=@(
  'apps/tigeriq-core/web-control-server.mjs',
  'apps/tigeriq-core/web-control.html',
  'scripts/tigeriq-core/run-web-control-bundle.ps1'
)

function Assert-ReleaseChangedPaths([string[]]$changedPaths,[hashtable]$impact,[string]$targetSha){
  if(-not $changedPaths -or @($changedPaths).Count -eq 0){return 'RELEASE_CHANGED_PATHS_MISSING'}
  $healthCssChanged=@($changedPaths|Where-Object{$_ -ceq 'public/work-center-visual.css'}).Count -gt 0
  $healthSeen=0
  $codingContractChanged=@($changedPaths|Where-Object{$_ -ceq 'apps/tigeriq-coding-lane/coding-lane.mjs'}).Count -gt 0
  $codingContractSeen=0
  $ownerV6Changed=@($changedPaths|Where-Object{$_ -ceq 'apps/shared/owner-interaction-v6.mjs'}).Count -gt 0
  $ownerV6Seen=0
  $sourceOnly=@('docs/PC01_GATED_RELEASE_PHASE1.md','vitest.config.ts','tests/pc01-release-guard-e2e.test.mjs','tests/pc01-release-preflight.test.mjs','tests/pc01-updater-release-gate.test.mjs','.github/ISSUE_TEMPLATE/work_order_v2.md','scripts/verify_work_board_ui.mjs','tests/continuous-capability-verify.test.mjs','tests/core-autonomous-rca.test.ts','tests/core-manager-stop-next.test.mjs','tests/github-intake.test.mjs','tests/live-status-api.test.mjs','tests/tigeriq-live-owner-refinement.test.mjs','tests/web-control.test.ts','tests/work-order-lifecycle-v2.test.mjs','bootstrap/02_TIGERIQ_WORKFLOW.md')
  foreach($path in $changedPaths){
    # Preserve the established source-only rule on unrelated releases.
    if($path -ceq 'vitest.config.ts' -and -not $impact.web){continue}
    # Exact, case-sensitive approved path AND exact blob from trusted local Git object DB.
    $pinned=@($ownerOneTapBlobs.Keys|Where-Object{$_ -ceq $path})
    if($pinned.Count -eq 1){
      if(-not $controlRepo){return 'RELEASE_ONE_TAP_PROVENANCE_MISSING'}
      try{
        $expected=[string]$ownerOneTapBlobs[$pinned[0]]
        $spec=$targetSha+':'+$path
        $actual=(& git -C $controlRepo rev-parse $spec 2>$null | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $actual -cne $expected){return 'RELEASE_ONE_TAP_CONTENT_MISMATCH'}
      }catch{return 'RELEASE_ONE_TAP_CONTENT_MISMATCH'}
      continue
    }
    if($healthCssChanged -and $ownerApiHealthBlobs.ContainsKey($path)){
      if(-not $controlRepo){return 'RELEASE_API_HEALTH_PROVENANCE_MISSING'}
      try{
        $expected=[string]$ownerApiHealthBlobs[$path]
        $actual=(& git -C $controlRepo rev-parse ($targetSha+':'+$path) 2>$null | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $actual -cne $expected){return 'RELEASE_API_HEALTH_CONTENT_MISMATCH'}
      }catch{return 'RELEASE_API_HEALTH_CONTENT_MISMATCH'}
      $healthSeen++
      if($path -ceq 'public/work-center-visual.css' -and -not $impact.core){return 'RELEASE_PATH_COMPONENT_MISMATCH'}
      continue
    }
    if($codingContractChanged -and $ownerCodingContractBlobs.ContainsKey($path)){
      if(-not $impact.coding){return 'RELEASE_PATH_COMPONENT_MISMATCH'}
      if(-not $controlRepo){return 'RELEASE_CODING_CONTRACT_PROVENANCE_MISSING'}
      try{
        $expected=[string]$ownerCodingContractBlobs[$path]
        $actual=(& git -C $controlRepo rev-parse ($targetSha+':'+$path) 2>$null | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $actual -cne $expected){return 'RELEASE_CODING_CONTRACT_CONTENT_MISMATCH'}
      }catch{return 'RELEASE_CODING_CONTRACT_CONTENT_MISMATCH'}
      $codingContractSeen++
      continue
    }
    if($ownerV6Changed -and $ownerV6Blobs.ContainsKey($path)){
      if(-not $impact.core){return 'RELEASE_PATH_COMPONENT_MISMATCH'}
      if(-not $controlRepo){return 'RELEASE_OWNER_V6_PROVENANCE_MISSING'}
      try{
        $expected=[string]$ownerV6Blobs[$path]
        $actual=(& git -C $controlRepo rev-parse ($targetSha+':'+$path) 2>$null | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $actual -cne $expected){return 'RELEASE_OWNER_V6_CONTENT_MISMATCH'}
      }catch{return 'RELEASE_OWNER_V6_CONTENT_MISMATCH'}
      $ownerV6Seen++
      continue
    }
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
  if($healthCssChanged -and $healthSeen -ne $ownerApiHealthBlobs.Count){return 'RELEASE_API_HEALTH_BUNDLE_INCOMPLETE'}
  if($codingContractChanged -and $codingContractSeen -ne $ownerCodingContractBlobs.Count){return 'RELEASE_CODING_CONTRACT_BUNDLE_INCOMPLETE'}
  if($ownerV6Changed -and $ownerV6Seen -ne $ownerV6Blobs.Count){return 'RELEASE_OWNER_V6_BUNDLE_INCOMPLETE'}
  return $null
}
# Signed V2: bounded path-class policy, no repeated manual blob pins.
# Legacy V1 remains unchanged. The separately verified OIDC ticket remains required.
function Assert-ReleaseChangedPathsV2([string[]]$changedPaths,[hashtable]$impact,[string]$targetSha){
  if(-not $changedPaths -or @($changedPaths).Count -eq 0){return 'RELEASE_CHANGED_PATHS_MISSING'}
  if(-not $controlRepo){return 'RELEASE_V2_PROVENANCE_MISSING'}
  $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  foreach($name in $changedPaths){
    if(-not $name -or $name -cnotmatch '^[A-Za-z0-9_./-]+$' -or $name.StartsWith('/') -or
       @($name.Split('/')|Where-Object{$_ -in @('..','.','')}).Count -gt 0 -or
       -not $seen.Add($name)){return 'RELEASE_V2_PATH_INVALID'}
    if($name -match '(?i)(app.?chrome|android|credential|secret|\.env|vercel\.json|^\.github/|^api/(?!live-status\.mjs$))'){
      return 'RELEASE_V2_FORBIDDEN_SURFACE'
    }
    $gitObject=(& git -C $controlRepo rev-parse ($targetSha+':'+$name) 2>$null|Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $gitObject -cnotmatch '^[a-f0-9]{40}$'){return 'RELEASE_V2_SOURCE_PROVENANCE_INVALID'}
    if($name -match '^(docs/[A-Za-z0-9_./-]+\.md|bootstrap/[A-Za-z0-9_./-]+\.md|tests/[A-Za-z0-9_./-]+\.(mjs|js|ts|tsx))$'){continue}
    if($name -match '^apps/tigeriq-coding-lane/[A-Za-z0-9_./-]+\.(mjs|js|json|html)$' -or
       $name -match '^scripts/tigeriq-core/(run-coding-lane|install-coding-lane)\.ps1$'){
      if(-not $impact.coding){return 'RELEASE_PATH_COMPONENT_MISMATCH'};continue
    }
    if($name -match '^apps/openclaw-tigeriq-runtime/[A-Za-z0-9_./-]+\.(mjs|js|json)$'){
      if(-not ($impact.openclaw -and $impact.core)){return 'RELEASE_PATH_COMPONENT_MISMATCH'};continue
    }
    if($name -match '^scripts/tigeriq-core/(update-core-runtime|pc01-release-guard|pc01-release-preflight|bootstrap-watchdog|install-core-updater)\.(ps1|mjs)$'){
      if(-not $impact.updater){return 'RELEASE_PATH_COMPONENT_MISMATCH'};continue
    }
    if($name -match '^apps/tigeriq-core/[A-Za-z0-9_./-]+\.(mjs|js|html|css)$' -or
       $name -match '^apps/shared/owner-(interaction-v6|one-tap-approval)\.mjs$' -or
       $name -eq 'apps/dashboard/src/bcct.mjs' -or
       $name -match '^public/(work-center(-visual)?|work-ui)(\.js|\.css)$' -or
       $name -eq 'scripts/package-bcct-runtime.mjs' -or
       $name -eq 'api/live-status.mjs' -or
       $name -match '^scripts/tigeriq-core/(run-core|install-core-task|run-web-control-bundle)\.ps1$'){
      if(-not ($impact.core -or $impact.web)){return 'RELEASE_PATH_COMPONENT_MISMATCH'};continue
    }
    return 'RELEASE_V2_PATH_OUT_OF_SCOPE'
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
    $snapshotV2=([string]$a.schema -ceq 'TIGERIQ_PC01_RELEASE_APPROVAL_V2')
    if(-not $snapshotV2 -and [string]$a.schema -ne 'TIGERIQ_PC01_RELEASE_APPROVAL_V1'){return @{approved=$false;reason='RELEASE_APPROVAL_SCHEMA_INVALID'}}
    if($snapshotV2 -and [string]$a.releasePolicy -cne 'SCOPED_SNAPSHOT_V2'){return @{approved=$false;reason='RELEASE_V2_POLICY_INVALID'}}
    if([string]$a.scope -ne 'TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1'){return @{approved=$false;reason='RELEASE_APPROVAL_SCOPE_INVALID'}}
    if([string]$a.targetSha -cne $targetSha){return @{approved=$false;reason='RELEASE_TARGET_MISMATCH'}}
    if([string]$a.expectedInstalledSha -cne $installedSha -or [string]$a.rollbackSha -cne $installedSha){return @{approved=$false;reason='RELEASE_BASELINE_MISMATCH'}}
    if([string]$a.requestId -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{3,119}$'){return @{approved=$false;reason='RELEASE_REQUEST_ID_INVALID'}}
    if($a.approved -cne $true){return @{approved=$false;reason='RELEASE_NOT_APPROVED'}}
    $expiry=[DateTime]::Parse([string]$a.expiresAtUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    $now=(Get-Date).ToUniversalTime()
    if($expiry -le $now -or $expiry -gt $now.AddDays(7)){return @{approved=$false;reason='RELEASE_APPROVAL_EXPIRED_OR_TOO_LONG'}}
    if($impact.liveBridge){return @{approved=$false;reason='RELEASE_IMPACT_OUT_OF_SCOPE'}}
    if(-not $snapshotV2 -and $impact.coding){
      foreach($wanted in $ownerCodingContractBlobs.Keys){
        if(@($changedPaths|Where-Object{$_ -ceq $wanted}).Count -ne 1){return @{approved=$false;reason='RELEASE_CODING_CONTRACT_BUNDLE_INCOMPLETE'}}
      }
    }
    if(-not $snapshotV2 -and $impact.web){
      # Exception applies only to the FULL eight-file PR #4746 bundle and protected
      # Core/Updater maintenance changes; no unrelated web deployment becomes eligible.
      if(-not($impact.core -and $impact.updater)){return @{approved=$false;reason='RELEASE_IMPACT_OUT_OF_SCOPE'}}
      foreach($wanted in $ownerOneTapBlobs.Keys){
        if(@($changedPaths|Where-Object{$_ -ceq $wanted}).Count -ne 1){return @{approved=$false;reason='RELEASE_ONE_TAP_BUNDLE_INCOMPLETE'}}
      }
      $webChanged=@($changedPaths|Where-Object{$_ -match '^apps/tigeriq-core/web-control(?:\.|-)' -or $_ -eq 'apps/tigeriq-core/owner-facing-vietnamese.mjs' -or $_ -match '^scripts/tigeriq-core/(?:run|install)-web-control'})
      foreach($webPath in $webChanged){
        if(@($ownerOneTapWebPaths|Where-Object{$_ -ceq $webPath}).Count -ne 1){return @{approved=$false;reason='RELEASE_IMPACT_OUT_OF_SCOPE'}}
      }
    }
    $pathDenial=if($snapshotV2){Assert-ReleaseChangedPathsV2 $changedPaths $impact $targetSha}else{Assert-ReleaseChangedPaths $changedPaths $impact $targetSha}
    if($pathDenial){return @{approved=$false;reason=$pathDenial}}
    if(-not($impact.coding -or $impact.core -or $impact.openclaw -or $impact.updater)){return @{approved=$false;reason='RELEASE_NO_APPROVED_COMPONENT_IMPACT'}}
    $wanted=@(@('coding','core','openclaw','updater')|Where-Object{$impact[$_] }|Sort-Object)
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
