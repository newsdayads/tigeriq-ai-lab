# GH-5135 F10: build-only exact-main unsigned/aligned handoff preparation.
# This script never signs, installs, stages Drive content, changes credentials, creates tasks, or touches Production.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ExpectedMainSha,
  [string]$RepoRoot='D:\TigerIQ\Apps\UltraCarHCM_V2\qa-gh5135-f10-current-main-nv02',
  [string]$DistRoot='D:\TigerIQ\Apps\UltraCarHCM_V2\dist',
  [string]$ToolsRoot='D:\TigerIQ\Tools'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

$expectedPackage='ai.tigeriq.ultracarhcm.v2'
$expectedVersionCode='11'
$expectedVersionName='2.0.0-dev.11'
$expectedSignerCert='71617043EACE89E5F220EA9168B0A9592808111B0F17EAA219F5E6ECEB569558'

$module=Join-Path $RepoRoot 'apps\ultracarhcm-v2'
$gradlew=Join-Path $module 'gradlew.bat'
$gradleFile=Join-Path $module 'app\build.gradle'
$unsigned=Join-Path $module 'app\build\outputs\apk\release\app-release-unsigned.apk'
$zipalign=Join-Path $ToolsRoot 'AndroidBuildTools35\unpacked\android-15\zipalign.exe'
$aapt2=Join-Path $ToolsRoot 'AndroidBuildTools35\unpacked\android-15\aapt2.exe'
$apksigner=Join-Path $ToolsRoot 'AndroidBuildTools35\unpacked\android-15\apksigner.bat'

foreach($required in @($RepoRoot,$module,$gradlew,$gradleFile,$zipalign,$aapt2,$apksigner)){
  if(-not (Test-Path -LiteralPath $required)){throw ('REQUIRED_PATH_MISSING:'+ $required)}
}

$head=(git -C $RepoRoot rev-parse HEAD 2>&1 | Select-Object -First 1).ToString().Trim()
if($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-fA-F]{40}$'){throw 'GIT_HEAD_READ_FAILED'}
if($head -cne $ExpectedMainSha){throw ('EXACT_MAIN_SHA_REQUIRED:EXPECTED='+$ExpectedMainSha+'|ACTUAL='+$head)}

$trackedStatus=(git -C $RepoRoot status --porcelain --untracked-files=no 2>&1) -join [Environment]::NewLine
if($LASTEXITCODE -ne 0){throw 'GIT_STATUS_FAILED'}
if(-not [string]::IsNullOrWhiteSpace($trackedStatus)){throw 'TRACKED_WORKTREE_MUST_BE_CLEAN'}

$gradleText=Get-Content -LiteralPath $gradleFile -Raw
if($gradleText -notmatch "applicationId\s+'ai\.tigeriq\.ultracarhcm\.v2'"){throw 'BUILD_PACKAGE_ID_MISMATCH'}
if($gradleText -notmatch 'versionCode\s+11\b'){throw 'BUILD_VERSION_CODE_MISMATCH'}
if($gradleText -notmatch "versionName\s+'2\.0\.0-dev\.11'"){throw 'BUILD_VERSION_NAME_MISMATCH'}

$shortSha=$head.Substring(0,8).ToLowerInvariant()
$baseName='UltraCarHCM_V2_2.0.0_dev11_MAIN_'+$shortSha
$output=Join-Path $DistRoot ($baseName+'_UNSIGNED_ALIGNED_HANDOFF.apk')
$manifest=Join-Path $DistRoot ($baseName+'_UNSIGNED_ALIGNED_HANDOFF.json')
$tempOutput=$output+'.tmp-'+[guid]::NewGuid().ToString('N')

if(-not (Test-Path -LiteralPath $DistRoot -PathType Container)){
  New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
}
if(Test-Path -LiteralPath $output){throw 'HANDOFF_OUTPUT_ALREADY_EXISTS_NO_OVERWRITE'}
if(Test-Path -LiteralPath $manifest){throw 'HANDOFF_MANIFEST_ALREADY_EXISTS_NO_OVERWRITE'}

Push-Location $module
try {
  & $gradlew --no-daemon clean :app:assembleRelease
  if($LASTEXITCODE -ne 0){throw ('GRADLE_RELEASE_BUILD_FAILED:'+ $LASTEXITCODE)}
} finally {
  Pop-Location
}

if(-not (Test-Path -LiteralPath $unsigned -PathType Leaf)){throw 'UNSIGNED_RELEASE_APK_MISSING'}

$unsignedVerification=(& $apksigner verify --verbose $unsigned 2>&1) -join [Environment]::NewLine
$unsignedVerifyExit=$LASTEXITCODE
if($unsignedVerifyExit -eq 0){throw 'UNSIGNED_BUILD_UNEXPECTEDLY_SIGNED'}

& $zipalign -f 4 $unsigned $tempOutput
if($LASTEXITCODE -ne 0){throw 'ZIPALIGN_FAILED'}
try {
  & $zipalign -c -v 4 $tempOutput | Out-Null
  if($LASTEXITCODE -ne 0){throw 'ZIPALIGN_VERIFY_FAILED'}

  $badging=(& $aapt2 dump badging $tempOutput 2>&1) -join [Environment]::NewLine
  if($LASTEXITCODE -ne 0){throw 'AAPT2_BADGING_FAILED'}
  $identityFragment="package: name='$expectedPackage' versionCode='$expectedVersionCode' versionName='$expectedVersionName'"
  if(-not $badging.Contains($identityFragment)){throw 'HANDOFF_APK_IDENTITY_MISMATCH'}

  $alignedVerification=(& $apksigner verify --verbose $tempOutput 2>&1) -join [Environment]::NewLine
  $alignedVerifyExit=$LASTEXITCODE
  if($alignedVerifyExit -eq 0){throw 'ALIGNED_HANDOFF_UNEXPECTEDLY_SIGNED'}

  Move-Item -LiteralPath $tempOutput -Destination $output
} finally {
  if(Test-Path -LiteralPath $tempOutput){
    Remove-Item -LiteralPath $tempOutput -Force -ErrorAction SilentlyContinue
  }
}

$artifactSha=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
$bytes=(Get-Item -LiteralPath $output).Length
$receipt=[ordered]@{
  schema='tigeriq.ultracarhcm-v2.unsigned-handoff.v1'
  workOrder='GH-5135'
  sourceSha=$head
  sourceShortSha=$shortSha
  packageName=$expectedPackage
  versionCode=[int]$expectedVersionCode
  versionName=$expectedVersionName
  artifactFileName=[IO.Path]::GetFileName($output)
  artifactPath=$output
  artifactSha256=$artifactSha
  bytes=$bytes
  zipAligned=$true
  signed=$false
  requiredSignerCertificateSha256=$expectedSignerCert
  buildTask=':app:assembleRelease'
  createdAtUtc=[DateTime]::UtcNow.ToString('o')
  drive='NOT_REQUESTED'
  install='NOT_REQUESTED'
  production=$false
}
$receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifest -Encoding UTF8

Write-Output ("F10_UNSIGNED_HANDOFF_PREP_PASS|SOURCE_SHA=$head|APK=$output|SHA256=$artifactSha|BYTES=$bytes|MANIFEST=$manifest|SIGNED=false|INSTALL=NOT_REQUESTED|DRIVE=NOT_REQUESTED|PRODUCTION=false")
