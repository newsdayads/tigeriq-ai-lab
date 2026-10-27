# UltraCar TEST-only release. Source is GitHub-owned; PC01 sign_latest.ps1 is unchanged.
# VerifyOnly is the default: no file, keystore or Drive changes.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^v(?:1\.0\.)?[0-9]{1,3}$')][string]$Version,
  [Parameter(Mandatory=$true)][ValidateRange(1,999999)][int]$VersionCode,
  [ValidateSet('VerifyOnly','Sign')][string]$Mode='VerifyOnly',
  [string]$ExpectedSha256='',
  [string]$AlignedSha256='',
  [string]$BuildDirectory='D:\TigerIQ\Apps\DeXCamPersonal\build',
  [string]$ToolsDirectory='D:\TigerIQ\Tools'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$patch=[int]($Version -replace '^v(?:1\.0\.)?','')
$label="v1.0.$patch"
$prefix="UltraCar_$label" + "_$VersionCode"
$signed=Join-Path $BuildDirectory ($prefix+'_signed_TEST.apk')
$aligned=Join-Path $BuildDirectory ($prefix+'_aligned_TEST.apk')
$apksigner=Join-Path $ToolsDirectory 'AndroidBuildTools35\unpacked\android-15\apksigner.bat'
$aapt2=Join-Path $ToolsDirectory 'AndroidBuildTools35\unpacked\android-15\aapt2.exe'
$zipalign=Join-Path $ToolsDirectory 'AndroidBuildTools35\unpacked\android-15\zipalign.exe'
$keystore=Join-Path $ToolsDirectory 'debug.keystore'
$cert='71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558'
if(-not (Test-Path -LiteralPath $apksigner -PathType Leaf)){throw 'APKSIGNER_MISSING'}
if(-not (Test-Path -LiteralPath $aapt2 -PathType Leaf)){throw 'AAPT2_MISSING'}
function Assert-Metadata([string]$Path) {
  $badging=(& $aapt2 dump badging $Path 2>&1) -join [Environment]::NewLine
  if($LASTEXITCODE -ne 0){throw 'AAPT2_FAILED'}
  $identity="package: name='com.tigeriq.dexsplit' versionCode='$VersionCode' versionName='TigerIQ_HCM_$label'"
  if(-not $badging.Contains($identity)){throw 'APK_IDENTITY_MISMATCH'}
}
if($Mode -eq 'Sign'){
  if(Test-Path -LiteralPath $signed){throw 'SIGNED_ALREADY_EXISTS_NO_OVERWRITE'}
  if(-not (Test-Path -LiteralPath $aligned -PathType Leaf)){throw 'EXACT_ALIGNED_APK_MISSING'}
  if($AlignedSha256 -cnotmatch '^[0-9a-fA-F]{64}$'){throw 'ALIGNED_SHA_REQUIRED'}
  $sourceHash=(Get-FileHash -LiteralPath $aligned -Algorithm SHA256).Hash
  if($sourceHash -ne $AlignedSha256){throw 'ALIGNED_SHA_MISMATCH'}
  if(-not (Test-Path -LiteralPath $zipalign -PathType Leaf)){throw 'ZIPALIGN_MISSING'}
  & $zipalign -c -v 4 $aligned | Out-Null
  if($LASTEXITCODE -ne 0){throw 'ZIPALIGN_VERIFY_FAILED'}
  Assert-Metadata $aligned
  if(-not (Test-Path -LiteralPath $keystore -PathType Leaf)){throw 'KEYSTORE_MISSING'}
  if([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('TIGERIQ_ULTRACAR_KS_PASS')) -or
     [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('TIGERIQ_ULTRACAR_KEY_PASS'))){
    throw 'SIGNING_ENV_CREDENTIALS_REQUIRED'
  }
  & $apksigner sign --ks $keystore --ks-pass 'env:TIGERIQ_ULTRACAR_KS_PASS' --key-pass 'env:TIGERIQ_ULTRACAR_KEY_PASS' --v2-signing-enabled true --v3-signing-enabled true --out $signed $aligned
  if($LASTEXITCODE -ne 0){throw 'APKSIGNER_SIGN_FAILED'}
} elseif($ExpectedSha256 -cnotmatch '^[0-9a-fA-F]{64}$'){
  throw 'SIGNED_SHA_REQUIRED'
}
if(-not (Test-Path -LiteralPath $signed -PathType Leaf)){throw 'EXACT_SIGNED_APK_MISSING'}
$sha=(Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash
if($Mode -eq 'VerifyOnly' -and $sha -ne $ExpectedSha256){throw 'SIGNED_SHA_MISMATCH'}
Assert-Metadata $signed
$verification=(& $apksigner verify --verbose --print-certs $signed 2>&1) -join [Environment]::NewLine
if($LASTEXITCODE -ne 0 -or $verification -notmatch '(?m)^Verifies\s*$'){throw 'APKSIGNER_VERIFY_FAILED'}
if($verification -notmatch 'Verified using v2 scheme[^\r\n]*:\s*true' -or
   $verification -notmatch 'Verified using v3 scheme[^\r\n]*:\s*true'){
  throw 'V2_V3_SIGNATURE_REQUIRED'
}
if(-not $verification.Contains("Signer #1 certificate SHA-256 digest: $cert")){
  throw 'CERTIFICATE_PIN_MISMATCH'
}
$size=(Get-Item -LiteralPath $signed).Length
$state=if($Mode -eq 'Sign'){'LOCAL_APK_SIGN_PASS'}else{'LOCAL_APK_VERIFY_PASS'}
Write-Output "$state|VERSION=$label|CODE=$VersionCode|BYTES=$size|SHA256=$sha|CLOUD=UNVERIFIED|DEX=UNVERIFIED"
