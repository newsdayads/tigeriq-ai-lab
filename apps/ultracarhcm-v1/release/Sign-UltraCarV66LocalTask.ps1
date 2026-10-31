# Trusted PC01 local-user signing task (for v66/307 TEST only).
# Task Scheduler must run as PC01\wdragons12x; ChatGPT may only trigger the already approved task.
# Signing passwords never enter ChatGPT, GitHub, tool calls, task arguments, stdout or logs.
[CmdletBinding()]
param([switch]$StageDrive)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if($identity -cne 'PC01\wdragons12x'){throw 'LOCAL_SIGNING_IDENTITY_REQUIRED'}
$root='D:\TigerIQ\Apps\DeXCamPersonal\build'
$repo='D:\TigerIQ\Workspace\tigeriq-ai-lab'
$runner=Join-Path $repo 'apps\ultracarhcm-v1\release\Invoke-UltraCarTestApk.ps1'
$aligned=Join-Path $root 'UltraCar_v1.0.66_307_aligned_TEST.apk'
$signed=Join-Path $root 'UltraCar_v1.0.66_307_signed_TEST.apk'
$expectedAligned='C68CFC6C4FF9F1C7E341C441B6E94154CB2F04CB26688E6F5900EE5539757D47'
if(-not (Test-Path -LiteralPath $runner -PathType Leaf)){throw 'GITHUB_SIGNING_RUNNER_MISSING'}
if(-not (Test-Path -LiteralPath $aligned -PathType Leaf)){throw 'ALIGNED_V66_MISSING'}
if((Get-FileHash -LiteralPath $aligned -Algorithm SHA256).Hash -cne $expectedAligned){
  throw 'ALIGNED_V66_PINNED_SHA_MISMATCH'
}
if(-not (Test-Path -LiteralPath $signed -PathType Leaf)){
  $store=Join-Path $env:LOCALAPPDATA 'TigerIQ\UltraCarSigner'
  $ksPath=Join-Path $store 'keystore-pass.dpapi'
  $keyPath=Join-Path $store 'key-pass.dpapi'
  if(-not (Test-Path -LiteralPath $ksPath -PathType Leaf) -or
     -not (Test-Path -LiteralPath $keyPath -PathType Leaf)){
    throw 'LOCAL_DPAPI_ENROLLMENT_REQUIRED'
  }
  $ks=Get-Content -LiteralPath $ksPath -Raw | ConvertTo-SecureString
  $key=Get-Content -LiteralPath $keyPath -Raw | ConvertTo-SecureString
  $ksPtr=[IntPtr]::Zero
  $keyPtr=[IntPtr]::Zero
  try {
    $ksPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($ks)
    $keyPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
    $env:TIGERIQ_ULTRACAR_KS_PASS=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ksPtr)
    $env:TIGERIQ_ULTRACAR_KEY_PASS=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)
    & $runner -Version v66 -VersionCode 307 -Mode Sign -AlignedSha256 $expectedAligned
    if(-not $?){throw 'LOCAL_SIGNER_FAILED'}
  } finally {
    Remove-Item Env:\TIGERIQ_ULTRACAR_KS_PASS -ErrorAction SilentlyContinue
    Remove-Item Env:\TIGERIQ_ULTRACAR_KEY_PASS -ErrorAction SilentlyContinue
    if($ksPtr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ksPtr)}
    if($keyPtr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)}
    if($ks){$ks.Dispose()}
    if($key){$key.Dispose()}
  }
} else {
  $signedSha=(Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash
  & $runner -Version v66 -VersionCode 307 -Mode VerifyOnly -ExpectedSha256 $signedSha
  if(-not $?){throw 'EXISTING_SIGNED_APK_INVALID'}
}
if(-not $StageDrive){
  Write-Output 'V66_SIGNED_LOCAL_ONLY|DRIVE=NOT_REQUESTED'
  return
}
# No overwrite and no unsigned/wildcard source. Runs only as the Drive-mapped local user.
$destinationRoot='G:\Drive của tôi\TigerIQ UltraCar'
if(-not (Test-Path -LiteralPath $destinationRoot -PathType Container)){
  throw 'LOCAL_DRIVE_FOLDER_NOT_MOUNTED'
}
$dest=Join-Path $destinationRoot 'UltraCar_v1.0.66_TEST.apk'
$sourceHash=(Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash
if(Test-Path -LiteralPath $dest){
  $currentHash=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
  if($currentHash -cne $sourceHash){throw 'DRIVE_NAME_COLLISION_NO_OVERWRITE'}
  Write-Output 'DRIVE_LOCAL_MIRROR_ALREADY_MATCHES|CLOUD_API_UNVERIFIED'
  return
}
# Atomic create-new prevents overwriting an existing Drive object.
$inputStream=[System.IO.File]::Open($signed,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)
try{
  $outputStream=[System.IO.File]::Open($dest,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
  try{$inputStream.CopyTo($outputStream)}finally{$outputStream.Dispose()}
}finally{$inputStream.Dispose()}
if((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -cne $sourceHash){
  throw 'DRIVE_LOCAL_MIRROR_HASH_MISMATCH'
}
Write-Output ('DRIVE_LOCAL_MIRROR_PASS|FILE=UltraCar_v1.0.66_TEST.apk|SHA256='+$sourceHash+'|CLOUD_API_UNVERIFIED|DEX_UNVERIFIED')
