# GH-5135 F10: narrowly scoped local-user signer for UltraCarHCM V2 dev.11 TEST only.
# This script never enrolls credentials, creates tasks, stages Drive files, installs APKs, or touches Production.
# It may run only as the already enrolled interactive Windows user PC01\wdragons12x.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if($identity -cne 'PC01\wdragons12x'){throw 'LOCAL_SIGNING_IDENTITY_REQUIRED'}

$input='D:\TigerIQ\Apps\UltraCarHCM_V2\dist\UltraCarHCM_V2_2.0.0_dev11_MAIN_9140534_UNSIGNED_ALIGNED_HANDOFF.apk'
$output='D:\TigerIQ\Apps\UltraCarHCM_V2\dist\UltraCarHCM_V2_2.0.0_dev11_MAIN_9140534_SIGNED_TEST.apk'
$expectedInputSha='73EF300739F7C356B7F6939EAC52246D8FEBA43B62335D40B9CA526E86E9D03C'
$expectedCert='71617043EACE89E5F220EA9168B0A9592808111B0F17EAA219F5E6ECEB569558'
$expectedPackage='ai.tigeriq.ultracarhcm.v2'
$expectedVersionCode='11'
$expectedVersionName='2.0.0-dev.11'
$tools='D:\TigerIQ\Tools'
$apksigner=Join-Path $tools 'AndroidBuildTools35\unpacked\android-15\apksigner.bat'
$aapt2=Join-Path $tools 'AndroidBuildTools35\unpacked\android-15\aapt2.exe'
$zipalign=Join-Path $tools 'AndroidBuildTools35\unpacked\android-15\zipalign.exe'
$keystore=Join-Path $tools 'debug.keystore'

foreach($required in @($input,$apksigner,$aapt2,$zipalign,$keystore)){
  if(-not (Test-Path -LiteralPath $required -PathType Leaf)){throw ('REQUIRED_FILE_MISSING:'+ $required)}
}
if(Test-Path -LiteralPath $output){throw 'SIGNED_OUTPUT_ALREADY_EXISTS_NO_OVERWRITE'}

$actualInputSha=(Get-FileHash -LiteralPath $input -Algorithm SHA256).Hash
if($actualInputSha -cne $expectedInputSha){throw 'DEV11_INPUT_SHA_MISMATCH'}

& $zipalign -c -v 4 $input | Out-Null
if($LASTEXITCODE -ne 0){throw 'DEV11_ZIPALIGN_VERIFY_FAILED'}

$badging=(& $aapt2 dump badging $input 2>&1) -join [Environment]::NewLine
if($LASTEXITCODE -ne 0){throw 'DEV11_AAPT2_FAILED'}
$identityFragment="package: name='$expectedPackage' versionCode='$expectedVersionCode' versionName='$expectedVersionName'"
if(-not $badging.Contains($identityFragment)){throw 'DEV11_APK_IDENTITY_MISMATCH'}

$store=Join-Path $env:LOCALAPPDATA 'TigerIQ\UltraCarSigner'
$ksPath=Join-Path $store 'keystore-pass.dpapi'
$keyPath=Join-Path $store 'key-pass.dpapi'
if(-not (Test-Path -LiteralPath $ksPath -PathType Leaf) -or
   -not (Test-Path -LiteralPath $keyPath -PathType Leaf)){
  throw 'LOCAL_DPAPI_ENROLLMENT_REQUIRED'
}

$ks=$null
$key=$null
$ksPtr=[IntPtr]::Zero
$keyPtr=[IntPtr]::Zero
try {
  $ks=Get-Content -LiteralPath $ksPath -Raw | ConvertTo-SecureString
  $key=Get-Content -LiteralPath $keyPath -Raw | ConvertTo-SecureString
  $ksPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($ks)
  $keyPtr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
  $env:TIGERIQ_ULTRACAR_KS_PASS=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ksPtr)
  $env:TIGERIQ_ULTRACAR_KEY_PASS=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)

  & $apksigner sign --ks $keystore --ks-pass 'env:TIGERIQ_ULTRACAR_KS_PASS' --key-pass 'env:TIGERIQ_ULTRACAR_KEY_PASS' --v2-signing-enabled true --v3-signing-enabled true --out $output $input
  if($LASTEXITCODE -ne 0){throw 'DEV11_APKSIGNER_SIGN_FAILED'}
} finally {
  Remove-Item Env:\TIGERIQ_ULTRACAR_KS_PASS -ErrorAction SilentlyContinue
  Remove-Item Env:\TIGERIQ_ULTRACAR_KEY_PASS -ErrorAction SilentlyContinue
  if($ksPtr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ksPtr)}
  if($keyPtr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)}
  if($ks){$ks.Dispose()}
  if($key){$key.Dispose()}
}

if(-not (Test-Path -LiteralPath $output -PathType Leaf)){throw 'DEV11_SIGNED_OUTPUT_MISSING'}
$verification=(& $apksigner verify --verbose --print-certs $output 2>&1) -join [Environment]::NewLine
if($LASTEXITCODE -ne 0 -or $verification -notmatch '(?m)^Verifies\s*$'){throw 'DEV11_APKSIGNER_VERIFY_FAILED'}
if($verification -notmatch 'Verified using v2 scheme[^\r\n]*:\s*true' -or
   $verification -notmatch 'Verified using v3 scheme[^\r\n]*:\s*true'){
  throw 'DEV11_V2_V3_SIGNATURE_REQUIRED'
}
if($verification -notmatch [regex]::Escape("Signer #1 certificate SHA-256 digest: $expectedCert")){
  throw 'DEV11_CERTIFICATE_PIN_MISMATCH'
}

$signedBadging=(& $aapt2 dump badging $output 2>&1) -join [Environment]::NewLine
if($LASTEXITCODE -ne 0 -or -not $signedBadging.Contains($identityFragment)){throw 'DEV11_SIGNED_IDENTITY_MISMATCH'}

$signedSha=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
$bytes=(Get-Item -LiteralPath $output).Length
Write-Output ("DEV11_LOCAL_SIGN_PASS|PACKAGE=$expectedPackage|VERSION=$expectedVersionName|CODE=$expectedVersionCode|BYTES=$bytes|SHA256=$signedSha|CERT=$expectedCert|DRIVE=NOT_REQUESTED|INSTALL=NOT_REQUESTED|PRODUCTION=false")
