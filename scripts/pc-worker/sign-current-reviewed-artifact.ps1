$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$RepoRoot='D:\TigerIQ\Runtime\CoreSource'
$MetadataPath=Join-Path $RepoRoot 'apps\android-worker\release\current-ci-artifact.json'
$ArtifactDir='D:\TigerIQ\Releases\AndroidWorker\ci-artifact\current'
$UnsignedApk=Join-Path $ArtifactDir 'tigeriq-worker-unsigned-release.apk'
$ApkSignerJar=Join-Path $ArtifactDir 'apksigner.jar'
$Helper=Join-Path $RepoRoot 'scripts\pc-worker\sign-android-worker-with-dpapi.ps1'
$SecretsDir='D:\TigerIQ\Secrets\AndroidSigning'

foreach($required in @($MetadataPath,$UnsignedApk,$ApkSignerJar,$Helper)){
  if(-not(Test-Path -LiteralPath $required -PathType Leaf)){throw 'CURRENT_CI_SIGN_INPUT_MISSING'}
}
try{$meta=Get-Content -LiteralPath $MetadataPath -Raw|ConvertFrom-Json -ErrorAction Stop}catch{throw 'CURRENT_CI_METADATA_INVALID'}
if([string]$meta.schema-ne'tigeriq.android-worker.ci-artifact.v1'){throw 'CURRENT_CI_METADATA_INVALID'}

$Version=[string]$meta.versionName
$VersionCode=[int]$meta.versionCode
$ExpectedUnsignedSha256=([string]$meta.unsignedApkSha256).Replace(':','').ToUpperInvariant()
$ExpectedApkSignerJarSha256=([string]$meta.apksignerJarSha256).Replace(':','').ToUpperInvariant()
$ExpectedSignerSha256=([string]$meta.signerSha256).Replace(':','').ToUpperInvariant()
$SourceArtifactSha=([string]$meta.sourceArtifactHead).ToLowerInvariant()
$SourceArtifactAndroidTreeSha=([string]$meta.sourceArtifactAndroidTreeSha).ToLowerInvariant()
$SourceWorkflowRunId=[string]$meta.workflowRunId
$SourceArtifactId=[string]$meta.artifactId
$SourceArtifactName=[string]$meta.artifactName
if($VersionCode-lt1 -or [string]::IsNullOrWhiteSpace($Version) -or $ExpectedUnsignedSha256-notmatch'^[0-9A-F]{64}$' -or $ExpectedApkSignerJarSha256-notmatch'^[0-9A-F]{64}$' -or $ExpectedSignerSha256-notmatch'^[0-9A-F]{64}$' -or $SourceArtifactSha-notmatch'^[0-9a-f]{40}$' -or $SourceArtifactAndroidTreeSha-notmatch'^[0-9a-f]{40}$' -or $SourceWorkflowRunId-notmatch'^\d+$' -or $SourceArtifactId-notmatch'^\d+$' -or [string]::IsNullOrWhiteSpace($SourceArtifactName)){throw 'CURRENT_CI_METADATA_INVALID'}

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$workerVersion=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\src\main\java\ai\tigeriq\worker\WorkerVersion.java') -Raw
$gradleVersion=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$gradleCode=[regex]::Match($gradle,'versionCode\s*=\s*(\d+)').Groups[1].Value
$workerName=[regex]::Match($workerVersion,'NAME\s*=\s*"([^"]+)"').Groups[1].Value
if($gradleVersion-ne$Version -or [int]$gradleCode-ne$VersionCode -or $workerName-ne$Version){throw 'CURRENT_CI_VERSION_MISMATCH'}

$unsignedHash=(Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($unsignedHash-ne$ExpectedUnsignedSha256){throw 'CURRENT_CI_UNSIGNED_SHA256_MISMATCH'}
$jarHash=(Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()
if($jarHash-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_CI_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_CI_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $ReleaseSourceSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $CurrentAndroidTreeSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha-ne$SourceArtifactAndroidTreeSha){throw 'CURRENT_CI_ANDROID_SOURCE_DRIFT'}
& $git.Source -C $RepoRoot merge-base --is-ancestor $SourceArtifactSha $ReleaseSourceSha
if($LASTEXITCODE-ne0){throw 'CURRENT_CI_SOURCE_ANCESTRY_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_CI_JAVA_REQUIRED'}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$OutputApk=Join-Path $ReleaseDir ("tigeriq-worker-$Version.apk")
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'
New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_CI_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_CI_SIGNER_RECEIPT_INVALID'}
if([string]$receipt.status-ne'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_CI_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).Replace(':','').ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_CI_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_CI_SIGNATURE_SCHEME_INVALID'}
if([string]$receipt.passwordTransport-ne'stdin-only'){throw 'CURRENT_CI_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_CI_SECRET_SAFETY_VIOLATION'}
if([string]$receipt.apksignerMode-ne'portable-pinned-jar' -or -not[bool]$receipt.prealignedInput){throw 'CURRENT_CI_SIGNER_MODE_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_CI_SIGNED_APK_MISSING'}
$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash-ne([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_CI_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1'
  createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version
  versionCode=$VersionCode
  applicationId=[string]$meta.applicationId
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
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
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY'
  version=$Version
  versionCode=$VersionCode
  apk=$OutputApk
  manifest=$ManifestPath
  apkSha256=$signedHash
  unsignedApkSha256=$ExpectedUnsignedSha256
  certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
  signingIdentity='stable-private-pc01-dpapi-stdin'
  passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar'
  prealignedInput=$true
  secretsPrinted=$false
}|ConvertTo-Json -Compress
 -or $ExpectedApkSignerJarSha256-notmatch'^[0-9A-F]{64}

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$workerVersion=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\src\main\java\ai\tigeriq\worker\WorkerVersion.java') -Raw
$gradleVersion=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$gradleCode=[regex]::Match($gradle,'versionCode\s*=\s*(\d+)').Groups[1].Value
$workerName=[regex]::Match($workerVersion,'NAME\s*=\s*"([^"]+)"').Groups[1].Value
if($gradleVersion-ne$Version -or [int]$gradleCode-ne$VersionCode -or $workerName-ne$Version){throw 'CURRENT_CI_VERSION_MISMATCH'}

$unsignedHash=(Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($unsignedHash-ne$ExpectedUnsignedSha256){throw 'CURRENT_CI_UNSIGNED_SHA256_MISMATCH'}
$jarHash=(Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()
if($jarHash-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_CI_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_CI_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $ReleaseSourceSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $CurrentAndroidTreeSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha-ne$SourceArtifactAndroidTreeSha){throw 'CURRENT_CI_ANDROID_SOURCE_DRIFT'}
& $git.Source -C $RepoRoot merge-base --is-ancestor $SourceArtifactSha $ReleaseSourceSha
if($LASTEXITCODE-ne0){throw 'CURRENT_CI_SOURCE_ANCESTRY_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_CI_JAVA_REQUIRED'}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$OutputApk=Join-Path $ReleaseDir ("tigeriq-worker-$Version.apk")
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'
New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_CI_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_CI_SIGNER_RECEIPT_INVALID'}
if([string]$receipt.status-ne'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_CI_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).Replace(':','').ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_CI_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_CI_SIGNATURE_SCHEME_INVALID'}
if([string]$receipt.passwordTransport-ne'stdin-only'){throw 'CURRENT_CI_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_CI_SECRET_SAFETY_VIOLATION'}
if([string]$receipt.apksignerMode-ne'portable-pinned-jar' -or -not[bool]$receipt.prealignedInput){throw 'CURRENT_CI_SIGNER_MODE_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_CI_SIGNED_APK_MISSING'}
$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash-ne([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_CI_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1'
  createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version
  versionCode=$VersionCode
  applicationId=[string]$meta.applicationId
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
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
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY'
  version=$Version
  versionCode=$VersionCode
  apk=$OutputApk
  manifest=$ManifestPath
  apkSha256=$signedHash
  unsignedApkSha256=$ExpectedUnsignedSha256
  certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
  signingIdentity='stable-private-pc01-dpapi-stdin'
  passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar'
  prealignedInput=$true
  secretsPrinted=$false
}|ConvertTo-Json -Compress
 -or $ExpectedSignerSha256-notmatch'^[0-9A-F]{64}

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$workerVersion=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\src\main\java\ai\tigeriq\worker\WorkerVersion.java') -Raw
$gradleVersion=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$gradleCode=[regex]::Match($gradle,'versionCode\s*=\s*(\d+)').Groups[1].Value
$workerName=[regex]::Match($workerVersion,'NAME\s*=\s*"([^"]+)"').Groups[1].Value
if($gradleVersion-ne$Version -or [int]$gradleCode-ne$VersionCode -or $workerName-ne$Version){throw 'CURRENT_CI_VERSION_MISMATCH'}

$unsignedHash=(Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($unsignedHash-ne$ExpectedUnsignedSha256){throw 'CURRENT_CI_UNSIGNED_SHA256_MISMATCH'}
$jarHash=(Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()
if($jarHash-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_CI_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_CI_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $ReleaseSourceSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $CurrentAndroidTreeSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha-ne$SourceArtifactAndroidTreeSha){throw 'CURRENT_CI_ANDROID_SOURCE_DRIFT'}
& $git.Source -C $RepoRoot merge-base --is-ancestor $SourceArtifactSha $ReleaseSourceSha
if($LASTEXITCODE-ne0){throw 'CURRENT_CI_SOURCE_ANCESTRY_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_CI_JAVA_REQUIRED'}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$OutputApk=Join-Path $ReleaseDir ("tigeriq-worker-$Version.apk")
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'
New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_CI_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_CI_SIGNER_RECEIPT_INVALID'}
if([string]$receipt.status-ne'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_CI_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).Replace(':','').ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_CI_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_CI_SIGNATURE_SCHEME_INVALID'}
if([string]$receipt.passwordTransport-ne'stdin-only'){throw 'CURRENT_CI_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_CI_SECRET_SAFETY_VIOLATION'}
if([string]$receipt.apksignerMode-ne'portable-pinned-jar' -or -not[bool]$receipt.prealignedInput){throw 'CURRENT_CI_SIGNER_MODE_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_CI_SIGNED_APK_MISSING'}
$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash-ne([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_CI_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1'
  createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version
  versionCode=$VersionCode
  applicationId=[string]$meta.applicationId
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
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
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY'
  version=$Version
  versionCode=$VersionCode
  apk=$OutputApk
  manifest=$ManifestPath
  apkSha256=$signedHash
  unsignedApkSha256=$ExpectedUnsignedSha256
  certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
  signingIdentity='stable-private-pc01-dpapi-stdin'
  passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar'
  prealignedInput=$true
  secretsPrinted=$false
}|ConvertTo-Json -Compress
 -or $SourceArtifactSha-notmatch'^[0-9a-f]{40}

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$workerVersion=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\src\main\java\ai\tigeriq\worker\WorkerVersion.java') -Raw
$gradleVersion=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$gradleCode=[regex]::Match($gradle,'versionCode\s*=\s*(\d+)').Groups[1].Value
$workerName=[regex]::Match($workerVersion,'NAME\s*=\s*"([^"]+)"').Groups[1].Value
if($gradleVersion-ne$Version -or [int]$gradleCode-ne$VersionCode -or $workerName-ne$Version){throw 'CURRENT_CI_VERSION_MISMATCH'}

$unsignedHash=(Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($unsignedHash-ne$ExpectedUnsignedSha256){throw 'CURRENT_CI_UNSIGNED_SHA256_MISMATCH'}
$jarHash=(Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()
if($jarHash-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_CI_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_CI_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $ReleaseSourceSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $CurrentAndroidTreeSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha-ne$SourceArtifactAndroidTreeSha){throw 'CURRENT_CI_ANDROID_SOURCE_DRIFT'}
& $git.Source -C $RepoRoot merge-base --is-ancestor $SourceArtifactSha $ReleaseSourceSha
if($LASTEXITCODE-ne0){throw 'CURRENT_CI_SOURCE_ANCESTRY_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_CI_JAVA_REQUIRED'}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$OutputApk=Join-Path $ReleaseDir ("tigeriq-worker-$Version.apk")
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'
New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_CI_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_CI_SIGNER_RECEIPT_INVALID'}
if([string]$receipt.status-ne'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_CI_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).Replace(':','').ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_CI_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_CI_SIGNATURE_SCHEME_INVALID'}
if([string]$receipt.passwordTransport-ne'stdin-only'){throw 'CURRENT_CI_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_CI_SECRET_SAFETY_VIOLATION'}
if([string]$receipt.apksignerMode-ne'portable-pinned-jar' -or -not[bool]$receipt.prealignedInput){throw 'CURRENT_CI_SIGNER_MODE_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_CI_SIGNED_APK_MISSING'}
$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash-ne([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_CI_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1'
  createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version
  versionCode=$VersionCode
  applicationId=[string]$meta.applicationId
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
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
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY'
  version=$Version
  versionCode=$VersionCode
  apk=$OutputApk
  manifest=$ManifestPath
  apkSha256=$signedHash
  unsignedApkSha256=$ExpectedUnsignedSha256
  certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
  signingIdentity='stable-private-pc01-dpapi-stdin'
  passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar'
  prealignedInput=$true
  secretsPrinted=$false
}|ConvertTo-Json -Compress
 -or $SourceArtifactAndroidTreeSha-notmatch'^[0-9a-f]{40}

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$workerVersion=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\src\main\java\ai\tigeriq\worker\WorkerVersion.java') -Raw
$gradleVersion=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$gradleCode=[regex]::Match($gradle,'versionCode\s*=\s*(\d+)').Groups[1].Value
$workerName=[regex]::Match($workerVersion,'NAME\s*=\s*"([^"]+)"').Groups[1].Value
if($gradleVersion-ne$Version -or [int]$gradleCode-ne$VersionCode -or $workerName-ne$Version){throw 'CURRENT_CI_VERSION_MISMATCH'}

$unsignedHash=(Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($unsignedHash-ne$ExpectedUnsignedSha256){throw 'CURRENT_CI_UNSIGNED_SHA256_MISMATCH'}
$jarHash=(Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()
if($jarHash-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_CI_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_CI_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $ReleaseSourceSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $CurrentAndroidTreeSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha-ne$SourceArtifactAndroidTreeSha){throw 'CURRENT_CI_ANDROID_SOURCE_DRIFT'}
& $git.Source -C $RepoRoot merge-base --is-ancestor $SourceArtifactSha $ReleaseSourceSha
if($LASTEXITCODE-ne0){throw 'CURRENT_CI_SOURCE_ANCESTRY_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_CI_JAVA_REQUIRED'}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$OutputApk=Join-Path $ReleaseDir ("tigeriq-worker-$Version.apk")
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'
New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_CI_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_CI_SIGNER_RECEIPT_INVALID'}
if([string]$receipt.status-ne'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_CI_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).Replace(':','').ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_CI_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_CI_SIGNATURE_SCHEME_INVALID'}
if([string]$receipt.passwordTransport-ne'stdin-only'){throw 'CURRENT_CI_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_CI_SECRET_SAFETY_VIOLATION'}
if([string]$receipt.apksignerMode-ne'portable-pinned-jar' -or -not[bool]$receipt.prealignedInput){throw 'CURRENT_CI_SIGNER_MODE_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_CI_SIGNED_APK_MISSING'}
$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash-ne([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_CI_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1'
  createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version
  versionCode=$VersionCode
  applicationId=[string]$meta.applicationId
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
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
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY'
  version=$Version
  versionCode=$VersionCode
  apk=$OutputApk
  manifest=$ManifestPath
  apkSha256=$signedHash
  unsignedApkSha256=$ExpectedUnsignedSha256
  certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
  signingIdentity='stable-private-pc01-dpapi-stdin'
  passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar'
  prealignedInput=$true
  secretsPrinted=$false
}|ConvertTo-Json -Compress
 -or $SourceWorkflowRunId-notmatch'^\d+

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$workerVersion=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\src\main\java\ai\tigeriq\worker\WorkerVersion.java') -Raw
$gradleVersion=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$gradleCode=[regex]::Match($gradle,'versionCode\s*=\s*(\d+)').Groups[1].Value
$workerName=[regex]::Match($workerVersion,'NAME\s*=\s*"([^"]+)"').Groups[1].Value
if($gradleVersion-ne$Version -or [int]$gradleCode-ne$VersionCode -or $workerName-ne$Version){throw 'CURRENT_CI_VERSION_MISMATCH'}

$unsignedHash=(Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($unsignedHash-ne$ExpectedUnsignedSha256){throw 'CURRENT_CI_UNSIGNED_SHA256_MISMATCH'}
$jarHash=(Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()
if($jarHash-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_CI_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_CI_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $ReleaseSourceSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $CurrentAndroidTreeSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha-ne$SourceArtifactAndroidTreeSha){throw 'CURRENT_CI_ANDROID_SOURCE_DRIFT'}
& $git.Source -C $RepoRoot merge-base --is-ancestor $SourceArtifactSha $ReleaseSourceSha
if($LASTEXITCODE-ne0){throw 'CURRENT_CI_SOURCE_ANCESTRY_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_CI_JAVA_REQUIRED'}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$OutputApk=Join-Path $ReleaseDir ("tigeriq-worker-$Version.apk")
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'
New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_CI_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_CI_SIGNER_RECEIPT_INVALID'}
if([string]$receipt.status-ne'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_CI_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).Replace(':','').ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_CI_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_CI_SIGNATURE_SCHEME_INVALID'}
if([string]$receipt.passwordTransport-ne'stdin-only'){throw 'CURRENT_CI_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_CI_SECRET_SAFETY_VIOLATION'}
if([string]$receipt.apksignerMode-ne'portable-pinned-jar' -or -not[bool]$receipt.prealignedInput){throw 'CURRENT_CI_SIGNER_MODE_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_CI_SIGNED_APK_MISSING'}
$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash-ne([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_CI_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1'
  createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version
  versionCode=$VersionCode
  applicationId=[string]$meta.applicationId
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
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
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY'
  version=$Version
  versionCode=$VersionCode
  apk=$OutputApk
  manifest=$ManifestPath
  apkSha256=$signedHash
  unsignedApkSha256=$ExpectedUnsignedSha256
  certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
  signingIdentity='stable-private-pc01-dpapi-stdin'
  passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar'
  prealignedInput=$true
  secretsPrinted=$false
}|ConvertTo-Json -Compress
 -or $SourceArtifactId-notmatch'^\d+

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$workerVersion=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\src\main\java\ai\tigeriq\worker\WorkerVersion.java') -Raw
$gradleVersion=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$gradleCode=[regex]::Match($gradle,'versionCode\s*=\s*(\d+)').Groups[1].Value
$workerName=[regex]::Match($workerVersion,'NAME\s*=\s*"([^"]+)"').Groups[1].Value
if($gradleVersion-ne$Version -or [int]$gradleCode-ne$VersionCode -or $workerName-ne$Version){throw 'CURRENT_CI_VERSION_MISMATCH'}

$unsignedHash=(Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($unsignedHash-ne$ExpectedUnsignedSha256){throw 'CURRENT_CI_UNSIGNED_SHA256_MISMATCH'}
$jarHash=(Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()
if($jarHash-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_CI_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_CI_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $ReleaseSourceSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $CurrentAndroidTreeSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha-ne$SourceArtifactAndroidTreeSha){throw 'CURRENT_CI_ANDROID_SOURCE_DRIFT'}
& $git.Source -C $RepoRoot merge-base --is-ancestor $SourceArtifactSha $ReleaseSourceSha
if($LASTEXITCODE-ne0){throw 'CURRENT_CI_SOURCE_ANCESTRY_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_CI_JAVA_REQUIRED'}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$OutputApk=Join-Path $ReleaseDir ("tigeriq-worker-$Version.apk")
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'
New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_CI_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_CI_SIGNER_RECEIPT_INVALID'}
if([string]$receipt.status-ne'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_CI_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).Replace(':','').ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_CI_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_CI_SIGNATURE_SCHEME_INVALID'}
if([string]$receipt.passwordTransport-ne'stdin-only'){throw 'CURRENT_CI_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_CI_SECRET_SAFETY_VIOLATION'}
if([string]$receipt.apksignerMode-ne'portable-pinned-jar' -or -not[bool]$receipt.prealignedInput){throw 'CURRENT_CI_SIGNER_MODE_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_CI_SIGNED_APK_MISSING'}
$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash-ne([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_CI_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1'
  createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version
  versionCode=$VersionCode
  applicationId=[string]$meta.applicationId
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
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
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY'
  version=$Version
  versionCode=$VersionCode
  apk=$OutputApk
  manifest=$ManifestPath
  apkSha256=$signedHash
  unsignedApkSha256=$ExpectedUnsignedSha256
  certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
  signingIdentity='stable-private-pc01-dpapi-stdin'
  passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar'
  prealignedInput=$true
  secretsPrinted=$false
}|ConvertTo-Json -Compress
 -or [string]::IsNullOrWhiteSpace($SourceArtifactName)){throw 'CURRENT_CI_METADATA_INVALID'}

$gradle=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\build.gradle.kts') -Raw
$workerVersion=Get-Content -LiteralPath (Join-Path $RepoRoot 'apps\android-worker\app\src\main\java\ai\tigeriq\worker\WorkerVersion.java') -Raw
$gradleVersion=[regex]::Match($gradle,'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$gradleCode=[regex]::Match($gradle,'versionCode\s*=\s*(\d+)').Groups[1].Value
$workerName=[regex]::Match($workerVersion,'NAME\s*=\s*"([^"]+)"').Groups[1].Value
if($gradleVersion-ne$Version -or [int]$gradleCode-ne$VersionCode -or $workerName-ne$Version){throw 'CURRENT_CI_VERSION_MISMATCH'}

$unsignedHash=(Get-FileHash -LiteralPath $UnsignedApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($unsignedHash-ne$ExpectedUnsignedSha256){throw 'CURRENT_CI_UNSIGNED_SHA256_MISMATCH'}
$jarHash=(Get-FileHash -LiteralPath $ApkSignerJar -Algorithm SHA256).Hash.ToUpperInvariant()
if($jarHash-ne$ExpectedApkSignerJarSha256){throw 'CURRENT_CI_APKSIGNER_JAR_SHA256_MISMATCH'}

$git=Get-Command git.exe -ErrorAction SilentlyContinue
if(-not $git){throw 'CURRENT_CI_GIT_REQUIRED'}
$ReleaseSourceSha=(& $git.Source -C $RepoRoot rev-parse HEAD).Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $ReleaseSourceSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_RELEASE_SOURCE_SHA_INVALID'}
$CurrentAndroidTreeSha=(& $git.Source -C $RepoRoot rev-parse 'HEAD:apps/android-worker').Trim().ToLowerInvariant()
if($LASTEXITCODE-ne0 -or $CurrentAndroidTreeSha-notmatch'^[0-9a-f]{40}$'){throw 'CURRENT_CI_ANDROID_TREE_SHA_INVALID'}
if($CurrentAndroidTreeSha-ne$SourceArtifactAndroidTreeSha){throw 'CURRENT_CI_ANDROID_SOURCE_DRIFT'}
& $git.Source -C $RepoRoot merge-base --is-ancestor $SourceArtifactSha $ReleaseSourceSha
if($LASTEXITCODE-ne0){throw 'CURRENT_CI_SOURCE_ANCESTRY_MISMATCH'}

$java=$null
if($env:TIGERIQ_JAVA -and (Test-Path -LiteralPath $env:TIGERIQ_JAVA -PathType Leaf)){$java=$env:TIGERIQ_JAVA}
if(-not $java){$cmd=Get-Command java.exe -ErrorAction SilentlyContinue;if($cmd){$java=$cmd.Source}}
if(-not $java -and $env:JAVA_HOME){$candidate=Join-Path $env:JAVA_HOME 'bin\java.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){$java=$candidate}}
if(-not $java){throw 'CURRENT_CI_JAVA_REQUIRED'}

$ReleaseDir=Join-Path 'D:\TigerIQ\Releases\AndroidWorker\signed' $Version
$OutputApk=Join-Path $ReleaseDir ("tigeriq-worker-$Version.apk")
$ManifestPath=Join-Path $ReleaseDir 'release-manifest.json'
New-Item -ItemType Directory -Force -Path $ReleaseDir|Out-Null
Remove-Item -LiteralPath $OutputApk,$ManifestPath -Force -ErrorAction SilentlyContinue

$helperOutput=& $Helper -UnsignedApk $UnsignedApk -OutputApk $OutputApk -ExpectedUnsignedSha256 $ExpectedUnsignedSha256 -SecretsDir $SecretsDir -ApkSignerJar $ApkSignerJar -ExpectedApkSignerJarSha256 $ExpectedApkSignerJarSha256 -Java $java -PrealignedInput
$receiptLine=$helperOutput|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)}|Select-Object -Last 1
if(-not $receiptLine){throw 'CURRENT_CI_SIGNER_RECEIPT_MISSING'}
try{$receipt=$receiptLine|ConvertFrom-Json}catch{throw 'CURRENT_CI_SIGNER_RECEIPT_INVALID'}
if([string]$receipt.status-ne'ANDROID_WORKER_CANONICAL_SIGNING_READY'){throw 'CURRENT_CI_SIGNER_STATUS_INVALID'}
if(([string]$receipt.certificateSha256).Replace(':','').ToUpperInvariant()-ne$ExpectedSignerSha256){throw 'CURRENT_CI_SIGNER_IDENTITY_MISMATCH'}
if(-not[bool]$receipt.v2 -or -not[bool]$receipt.v3){throw 'CURRENT_CI_SIGNATURE_SCHEME_INVALID'}
if([string]$receipt.passwordTransport-ne'stdin-only'){throw 'CURRENT_CI_PASSWORD_TRANSPORT_INVALID'}
if([bool]$receipt.plaintextSecretPrinted -or [bool]$receipt.plaintextSecretWrittenToDisk){throw 'CURRENT_CI_SECRET_SAFETY_VIOLATION'}
if([string]$receipt.apksignerMode-ne'portable-pinned-jar' -or -not[bool]$receipt.prealignedInput){throw 'CURRENT_CI_SIGNER_MODE_INVALID'}
if(-not(Test-Path -LiteralPath $OutputApk -PathType Leaf)){throw 'CURRENT_CI_SIGNED_APK_MISSING'}
$signedHash=(Get-FileHash -LiteralPath $OutputApk -Algorithm SHA256).Hash.ToUpperInvariant()
if($signedHash-ne([string]$receipt.signedSha256).ToUpperInvariant()){throw 'CURRENT_CI_SIGNED_SHA256_MISMATCH'}

$manifest=[ordered]@{
  schema='tigeriq.android-worker.release.v1'
  createdAt=(Get-Date).ToUniversalTime().ToString('o')
  version=$Version
  versionCode=$VersionCode
  applicationId=[string]$meta.applicationId
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
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
[IO.File]::WriteAllText($ManifestPath,($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))

[ordered]@{
  status='ANDROID_WORKER_STABLE_RELEASE_READY'
  version=$Version
  versionCode=$VersionCode
  apk=$OutputApk
  manifest=$ManifestPath
  apkSha256=$signedHash
  unsignedApkSha256=$ExpectedUnsignedSha256
  certificateSha256=$ExpectedSignerSha256
  sourceSha=$ReleaseSourceSha
  sourceArtifactSha=$SourceArtifactSha
  sourceArtifactAndroidTreeSha=$SourceArtifactAndroidTreeSha
  sourceWorkflowRunId=$SourceWorkflowRunId
  sourceArtifactId=$SourceArtifactId
  sourceArtifactName=$SourceArtifactName
  signingIdentity='stable-private-pc01-dpapi-stdin'
  passwordTransport='stdin-only'
  apksignerMode='portable-pinned-jar'
  prealignedInput=$true
  secretsPrinted=$false
}|ConvertTo-Json -Compress
