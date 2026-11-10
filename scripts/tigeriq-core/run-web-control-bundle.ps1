$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=$PSScriptRoot
$runtimeRepo='D:\TigerIQ\Runtime\CoreSource'
$runtimeSourceState='C:\ProgramData\TigerIQCoreRelease\State\core-runtime-source.json'
$runtimeReleaseAttempt='C:\ProgramData\TigerIQCoreRelease\core-runtime-release-attempt.json'
function Test-ProtectedReleaseAttemptAcl {
  $trusted=@('S-1-5-18','S-1-5-32-544')
  $writeMask=[System.Security.AccessControl.FileSystemRights]::Write -bor
             [System.Security.AccessControl.FileSystemRights]::Modify -bor
             [System.Security.AccessControl.FileSystemRights]::FullControl -bor
             [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
             [System.Security.AccessControl.FileSystemRights]::TakeOwnership -bor
             [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
  try{
    if(-not [Environment]::OSVersion.Platform.ToString().Equals('Win32NT')){return $false}
    if(-not(Test-Path -LiteralPath $runtimeReleaseAttempt -PathType Leaf)){return $false}
    foreach($path in @((Split-Path -Parent $runtimeReleaseAttempt),$runtimeReleaseAttempt)){
      $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){return $false}
      $acl=Get-Acl -LiteralPath $path -ErrorAction Stop
      if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin $trusted){return $false}
      foreach($ace in @($acl.Access)){
        if([string]$ace.AccessControlType -ne 'Allow'){continue}
        $sid=$ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if($sid -notin $trusted -and ($ace.FileSystemRights -band $writeMask) -ne 0){return $false}
      }
    }
    return $true
  }catch{return $false}
}
function Resolve-TrustedRuntimeRepo {
  $sha=$null
  if(Test-Path -LiteralPath $runtimeSourceState){
    try{$meta=Get-Content -Raw -LiteralPath $runtimeSourceState|ConvertFrom-Json -ErrorAction Stop}catch{throw 'RUNTIME_SOURCE_STATE_INVALID'}
    if([string]$meta.schema -ne 'TIGERIQ_RUNTIME_SOURCE_V1'){throw 'RUNTIME_SOURCE_SCHEMA_INVALID'}
    if([string]$meta.sourcePath -ne $runtimeRepo){throw 'RUNTIME_SOURCE_PATH_UNTRUSTED'}
    $sha=[string]$meta.currentSha
    if($sha -notmatch '^[0-9a-f]{40}$'){throw 'RUNTIME_SOURCE_SHA_INVALID'}
  }else{
    # One-time bootstrap bridge for the protected-state migration. Trust only the
    # SYSTEM/Administrators-owned release attempt written by the installed guard.
    if(-not(Test-Path -LiteralPath $runtimeReleaseAttempt)){throw 'RUNTIME_SOURCE_STATE_MISSING'}
    if(-not(Test-ProtectedReleaseAttemptAcl)){throw 'RUNTIME_RELEASE_ATTEMPT_ACL_UNTRUSTED'}
    try{$attempt=Get-Content -Raw -LiteralPath $runtimeReleaseAttempt|ConvertFrom-Json -ErrorAction Stop}catch{throw 'RUNTIME_RELEASE_ATTEMPT_INVALID'}
    if([string]$attempt.schema -ne 'TIGERIQ_PC01_RELEASE_ATTEMPT_V1' -or [string]$attempt.result -ne 'STARTED'){
      throw 'RUNTIME_RELEASE_ATTEMPT_NOT_INFLIGHT'
    }
    $sha=[string]$attempt.targetSha
    if($sha -notmatch '^[0-9a-f]{40}$' -or [string]$attempt.previousSha -notmatch '^[0-9a-f]{40}$'){
      throw 'RUNTIME_RELEASE_ATTEMPT_SHA_INVALID'
    }
  }
  if(-not(Test-Path -LiteralPath $runtimeRepo)){throw 'RUNTIME_SOURCE_MISSING'}
  $head=([string](& git -C $runtimeRepo rev-parse HEAD 2>$null)).Trim()
  if($LASTEXITCODE -ne 0 -or $head -ne $sha){throw 'RUNTIME_SOURCE_HEAD_MISMATCH'}
  $dirty=@(& git -C $runtimeRepo status --porcelain 2>$null)
  if($LASTEXITCODE -ne 0){throw 'RUNTIME_SOURCE_STATUS_FAILED'}
  if($dirty.Count){throw 'RUNTIME_SOURCE_DIRTY'}
  return $runtimeRepo
}
$repo=Resolve-TrustedRuntimeRepo
$sourceRoot=Join-Path $repo 'apps\tigeriq-core'

# Keep the runtime bundle complete and future-proof. The updater fast-forwards the
# canonical repo before restarting this task, then this launcher atomically syncs
# every Web Control asset required by the current server implementation.
if(-not(Test-Path -LiteralPath $sourceRoot)){throw 'WEB_CONTROL_SOURCE_ROOT_MISSING'}
$assets=@(Get-ChildItem -LiteralPath $sourceRoot -File | Where-Object {
  $_.Name -eq 'web-control-server.mjs' -or
  $_.Name -eq 'web-control.html' -or
  $_.Name -eq 'work-order-checklist-hard-gate.mjs' -or
  $_.Name -eq 'work-order-lifecycle-v2.mjs' -or
  $_.Name -eq 'workforce-registry.mjs' -or
  $_.Name -eq 'github-shared-client.mjs' -or
  $_.Name -eq 'owner-backlog-order.mjs' -or
  $_.Name -like 'web-control-*.mjs' -or
  $_.Name -like 'web-control-*.js' -or
  $_.Name -like 'web-control-*.css'
})
if(-not $assets.Count){throw 'WEB_CONTROL_ASSETS_MISSING'}
foreach($asset in $assets){
  $target=Join-Path $root $asset.Name
  $tmp=$target+'.tmp'
  Copy-Item -LiteralPath $asset.FullName -Destination $tmp -Force
  Move-Item -LiteralPath $tmp -Destination $target -Force
}

# Bundle the scoped Owner approval validator. A missing dependency fails closed.
$approvalSrc=Join-Path $repo 'apps\shared\owner-one-tap-approval.mjs'
if(-not(Test-Path -LiteralPath $approvalSrc)){throw 'OWNER_APPROVAL_SOURCE_MISSING'}
$approvalDst=Join-Path $root 'owner-one-tap-approval.mjs'
$approvalTmp=$approvalDst+'.tmp'
Copy-Item -LiteralPath $approvalSrc -Destination $approvalTmp -Force
Move-Item -LiteralPath $approvalTmp -Destination $approvalDst -Force

# Include public Work Center assets: the bundled server is outside the GitHub source tree.
$sharedRoot=Join-Path $repo 'public'
foreach($name in @('work-center.js','work-ui.css','work-center-visual.css')){
  $src=Join-Path $sharedRoot $name
  if(-not(Test-Path -LiteralPath $src)){throw ('WEB_CONTROL_SHARED_ASSET_MISSING:'+ $name)}
  $dst=Join-Path $root $name
  $tmp=$dst+'.tmp'
  Copy-Item -LiteralPath $src -Destination $tmp -Force
  Move-Item -LiteralPath $tmp -Destination $dst -Force
}

$app=Join-Path $root 'web-control-server.mjs'
if(-not(Test-Path -LiteralPath $app)){throw 'WEB_CONTROL_SERVER_MISSING'}
$tail=(tailscale ip -4 2>$null | Select-Object -First 1)
$hostIp=if($tail){[string]$tail}else{'127.0.0.1'}
$env:TIGERIQ_WEB_CONTROL_HOST=$hostIp
$env:TIGERIQ_WEB_CONTROL_PORT='8796'
$env:TIGERIQ_CORE_URL=('http://'+$hostIp+':8795')
$env:TIGERIQ_CODING_LANE_URL='http://127.0.0.1:8797'
& 'C:\Program Files\nodejs\node.exe' $app
exit $LASTEXITCODE
