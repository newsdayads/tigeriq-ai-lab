$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$RepoRoot='D:\TigerIQ\Runtime\CoreSource'
$MetadataPath=Join-Path $RepoRoot 'config\android-worker-current-ci-artifact.json'
$ArtifactDir='D:\TigerIQ\Releases\AndroidWorker\ci-artifact\current'
$Helper=Join-Path $RepoRoot 'scripts\pc-worker\sign-android-worker-with-dpapi.ps1'
$SecretsDir='D:\TigerIQ\Secrets\AndroidSigning'

if(-not(Test-Path -LiteralPath $MetadataPath -PathType Leaf)){throw 'CURRENT_CI_METADATA_MISSING'}
try{$spec=Get-Content -LiteralPath $MetadataPath -Raw|ConvertFrom-Json -ErrorAction Stop}catch{throw 'CURRENT_CI_METADATA_INVALID'}
if(([string]$spec.schema) -ne 'tigeriq.android-worker.ci-artifact.v1'){throw 'CURRENT_CI_METADATA_SCHEMA_INVALID'}
if(([string]$spec.repo) -ne 'newsdayads/tigeriq-ai-lab'){throw 'CURRENT_CI_METADATA_REPO_INVALID'}
if(([string]$spec.artifactName) -ne 'tigeriq-worker-unsigned-release-apk'){throw 'CURRENT_CI_METADATA_ARTIFACT_NAME_INVALID'}

$Version=[string]$spec.expectedVersion
$ExpectedUnsignedSha256=([string]$spec.expectedUnsignedSha256).ToUpperInvariant()
$ExpectedApkSignerJarSha256=([string]$spec.expectedApkSignerJarSha256).ToUpperInvariant()
$ExpectedSignerSha256=([string]$spec.expectedSignerSha256).ToUpperInvariant()
$CanonicalSignerSha256='63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293'
$SourceArtifactSha=([string]$spec.sourceArtifactHead).ToLowerInvariant()
$SourceArtifactAndroidTreeSha=([string]$spec.sourceArtifactAndroidTreeSha).ToLowerInvariant()
$SourceWorkflowRunId=[string]$spec.runId
$SourceArtifactId=[string]$spec.artifactId

if($Version -notmatch  '^\d+\.\d+\.\d+[A-Za-z0-9._-]*$'){throw 'CURRENT_CI_VERSION_INVALID'}
foreach($hash in @($ExpectedUnsignedSha256,$ExpectedApkSignerJarSha256,$ExpectedSignerSha256)){if($hash -notmatch  '^[0-9A-F]{64}
foreach($sha in @($SourceArtifactSha,$SourceArtifactAndroidTreeSha)){if($sha -notmatch  '^[0-9a-f]{40}$'){throw 'CURRENT_CI_SOURCE_INVALID'}}
foreach($id in @($SourceWorkflowRunId,$SourceArtifactId)){if($id -notmatch  '^\d{6,20}$'){throw 'CURRENT_CI_ID_INVALID'}}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$UnsignedApk=Join-Path $ArtifactDir 'tigeriq-worker-unsigned-release.apk'
$ApkSignerJar=Join-Path $ArtifactDir 'apksigner.jar'
$OutputApk=Join-Path $ReleaseDir ('tigeriq-worker-'+$Version+'.apk')
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'

foreach($required in @($UnsignedApk,$ApkSignerJar,$Helper)){if(-not(Test-Path -LiteralPath $required -PathType Leaf)){throw ('CURRENT_SIGN_INPUT_MISSING:'+ $required)}}
if((Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()-ne$ExpectedUnsignedSha256){throw 'CURRENT_UNSIGNED_SHA256_MISMATCH'}
if((Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE -ne 0 -or $ReleaseSourceSha -notmatch  '^[0-9a-f]{40}$'){throw 'CURRENT_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE -ne 0 -or $CurrentAndroidTreeSha -notmatch  '^[0-9a-f]{40}$'){throw 'CURRENT_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha -ne $SourceArtifactAndroidTreeSha){throw 'CURRENT_ANDROID_SOURCE_DRIFT'}

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$versionMatch=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"')
if(-not $versionMatch.Success -or ([string]$versionMatch.Groups[1].Value) -ne $Version){throw 'CURRENT_VERSION_SOURCE_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_JAVA_REQUIRED'}

New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_SIGNER_RECEIPT_INVALID'}
if(([string]$receipt.status) -ne 'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_SIGNATURE_SCHEME_INVALID'}
if(([string]$receipt.passwordTransport) -ne 'stdin-only'){throw 'CURRENT_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_SECRET_SAFETY_VIOLATION'}
if(([string]$receipt.apksignerMode) -ne 'portable-pinned-jar'){throw 'CURRENT_APKSIGNER_MODE_INVALID'}
if(-not[bool]$receipt.prealignedInput){throw 'CURRENT_PREALIGNED_RECEIPT_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_SIGNED_APK_MISSING'}

$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash -ne ([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1';createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version;applicationId='ai.tigeriq.worker';sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha;sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId;sourceArtifactId=$SourceArtifactId
  unsignedApkSha256=$ExpectedUnsignedSha256;apk=(Split-Path $OutputApk -Leaf);apkSha256=$signedHash
  certificateSha256=$ExpectedSignerSha256;signingIdentity='stable-private-pc01-dpapi-stdin'
  apksignerMode='portable-pinned-jar';apksignerJarSha256=$ExpectedApkSignerJarSha256
  prealignedInput=$true;secretsIncluded=$false
}
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY';version=$Version;apk=$OutputApk;manifest=$ManifestPath
  apkSha256=$signedHash;unsignedApkSha256=$ExpectedUnsignedSha256;certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha;sourceArtifactSha=$SourceArtifactSha;sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId;sourceArtifactId=$SourceArtifactId
  signingIdentity='stable-private-pc01-dpapi-stdin';passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar';prealignedInput=$true;secretsPrinted=$false
}|ConvertTo-Json -Compress
){throw 'CURRENT_CI_HASH_INVALID'}}
if($ExpectedSignerSha256 -ne $CanonicalSignerSha256){throw 'CURRENT_CI_SIGNER_PIN_MISMATCH'}
foreach($sha in @($SourceArtifactSha,$SourceArtifactAndroidTreeSha)){if($sha -notmatch  '^[0-9a-f]{40}$'){throw 'CURRENT_CI_SOURCE_INVALID'}}
foreach($id in @($SourceWorkflowRunId,$SourceArtifactId)){if($id -notmatch  '^\d{6,20}$'){throw 'CURRENT_CI_ID_INVALID'}}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$UnsignedApk=Join-Path $ArtifactDir 'tigeriq-worker-unsigned-release.apk'
$ApkSignerJar=Join-Path $ArtifactDir 'apksigner.jar'
$OutputApk=Join-Path $ReleaseDir ('tigeriq-worker-'+$Version+'.apk')
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'

foreach($required in @($UnsignedApk,$ApkSignerJar,$Helper)){if(-not(Test-Path -LiteralPath $required -PathType Leaf)){throw ('CURRENT_SIGN_INPUT_MISSING:'+ $required)}}
if((Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()-ne$ExpectedUnsignedSha256){throw 'CURRENT_UNSIGNED_SHA256_MISMATCH'}
if((Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE -ne 0 -or $ReleaseSourceSha -notmatch  '^[0-9a-f]{40}$'){throw 'CURRENT_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE -ne 0 -or $CurrentAndroidTreeSha -notmatch  '^[0-9a-f]{40}$'){throw 'CURRENT_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha -ne $SourceArtifactAndroidTreeSha){throw 'CURRENT_ANDROID_SOURCE_DRIFT'}

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$versionMatch=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"')
if(-not $versionMatch.Success -or ([string]$versionMatch.Groups[1].Value) -ne $Version){throw 'CURRENT_VERSION_SOURCE_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_JAVA_REQUIRED'}

New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_SIGNER_RECEIPT_INVALID'}
if(([string]$receipt.status) -ne 'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_SIGNATURE_SCHEME_INVALID'}
if(([string]$receipt.passwordTransport) -ne 'stdin-only'){throw 'CURRENT_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_SECRET_SAFETY_VIOLATION'}
if(([string]$receipt.apksignerMode) -ne 'portable-pinned-jar'){throw 'CURRENT_APKSIGNER_MODE_INVALID'}
if(-not[bool]$receipt.prealignedInput){throw 'CURRENT_PREALIGNED_RECEIPT_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_SIGNED_APK_MISSING'}

$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash -ne ([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1';createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version;applicationId='ai.tigeriq.worker';sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha;sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId;sourceArtifactId=$SourceArtifactId
  unsignedApkSha256=$ExpectedUnsignedSha256;apk=(Split-Path $OutputApk -Leaf);apkSha256=$signedHash
  certificateSha256=$ExpectedSignerSha256;signingIdentity='stable-private-pc01-dpapi-stdin'
  apksignerMode='portable-pinned-jar';apksignerJarSha256=$ExpectedApkSignerJarSha256
  prealignedInput=$true;secretsIncluded=$false
}
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY';version=$Version;apk=$OutputApk;manifest=$ManifestPath
  apkSha256=$signedHash;unsignedApkSha256=$ExpectedUnsignedSha256;certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha;sourceArtifactSha=$SourceArtifactSha;sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId;sourceArtifactId=$SourceArtifactId
  signingIdentity='stable-private-pc01-dpapi-stdin';passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar';prealignedInput=$true;secretsPrinted=$false
}|ConvertTo-Json -Compress
