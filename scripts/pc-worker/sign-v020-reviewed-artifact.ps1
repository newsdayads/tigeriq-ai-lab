$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$ExpectedUnsignedSha256='BDC32789297BB5304AE423476D8C4170C9D17C0B9AC2D7C5533DA42FBA82F598'
$ExpectedApkSignerJarSha256='00EF9948F843FE395D2440AE3EF41405B8040A6D5D46493BD1902AC0EE6DEAE7'
$ExpectedSignerSha256='63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293'
$SourceSha='8364e79ef5a03d5d95663e511c076f5be4f5003a'
$SourceWorkflowRunId='37119358164'
$SourceArtifactId='11273046069'
$Version='0.20.0-update-lease-guard'

$RepoRoot='D:\TigerIQ\Runtime\CoreSource'
$ArtifactDir='D:\TigerIQ\Releases\AndroidWorker\ci-artifact\v0.20'
$ReleaseDir='D:\TigerIQ\Releases\AndroidWorker\signed\0.20.0-update-lease-guard'
$UnsignedApk=Join-Path $ArtifactDir 'tigeriq-worker-unsigned-release.apk'
$ApkSignerJar=Join-Path $ArtifactDir 'apksigner.jar'
$OutputApk=Join-Path $ReleaseDir 'TIQ Worker v0.20.apk'
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'
$Helper=Join-Path $RepoRoot 'scripts\pc-worker\sign-android-worker-with-dpapi.ps1'
$SecretsDir='D:\TigerIQ\Secrets\AndroidSigning'

foreach($required in @($UnsignedApk,$ApkSignerJar,$Helper)){
  if(-not(Test-Path -LiteralPath $required -PathType Leaf)){throw ('V020_SIGN_INPUT_MISSING:'+ $required)}
}
$unsignedHash=(Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($unsignedHash-ne$ExpectedUnsignedSha256){throw 'V020_UNSIGNED_SHA256_MISMATCH'}
$jarHash=(Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()
if($jarHash-ne$ExpectedApkSignerJarSha256){throw 'V020_APKSIGNER_JAR_SHA256_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'V020_JAVA_REQUIRED'}

New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'V020_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'V020_SIGNER_RECEIPT_INVALID'}

if([string]$receipt.status-ne'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'V020_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'V020_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'V020_SIGNATURE_SCHEME_INVALID'}
if([string]$receipt.passwordTransport-ne'stdin-only'){throw 'V020_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'V020_SECRET_SAFETY_VIOLATION'}
if([string]$receipt.apksignerMode-ne'portable-pinned-jar'){throw 'V020_APKSIGNER_MODE_INVALID'}
if(-not[bool]$receipt.prealignedInput){throw 'V020_PREALIGNED_RECEIPT_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'V020_SIGNED_APK_MISSING'}

$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash-ne([string]$receipt.signedSha256).ToUpperInvariant()){throw 'V020_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1'
  createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version
  applicationId='ai.tigeriq.worker'
  sourceSha=$SourceSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  unsignedApkSha256=$ExpectedUnsignedSha256
  apk=(Split-Path $OutputApk -Leaf)
  apkSha256=$signedHash
  certificateSha256=$ExpectedSignerSha256
  signingIdentity='stable-private-pc01-dpapi-stdin'
  apksignerMode='portable-pinned-jar'
  apksignerJarSha256=$ExpectedApkSignerJarSha256
  prealignedInput=$true
  secretsIncluded=$false
}
$manifest|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $ManifestPath -Encoding utf8

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY'
  version=$Version
  apk=$OutputApk
  manifest=$ManifestPath
  apkSha256=$signedHash
  unsignedApkSha256=$ExpectedUnsignedSha256
  certificateSha256=$ExpectedSignerSha256
  sourceSha=$SourceSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  signingIdentity='stable-private-pc01-dpapi-stdin'
  passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar'
  prealignedInput=$true
  secretsPrinted=$false
}|ConvertTo-Json -Compress
