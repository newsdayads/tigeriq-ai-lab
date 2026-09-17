param(
  [string]$ArtifactDir,
  [string]$InstallRoot = 'D:\TigerIQ\Apps\WorkerUtility'
)
$ErrorActionPreference='Stop'
if(-not (Test-Path $ArtifactDir)){ throw 'ARTIFACT_DIR_NOT_FOUND' }
$exe=Join-Path $ArtifactDir 'TigerIQ.WorkerUtility.exe'
if(-not (Test-Path $exe)){ throw 'UTILITY_EXE_NOT_FOUND' }
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$target=Join-Path $InstallRoot ("Current-v1-$stamp")
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item (Join-Path $ArtifactDir '*') $target -Recurse -Force
$hash=(Get-FileHash (Join-Path $target 'TigerIQ.WorkerUtility.exe') -Algorithm SHA256).Hash.ToLower()
@{ installedAt=(Get-Date).ToString('o'); target=$target; sha256=$hash } |
  ConvertTo-Json | Set-Content (Join-Path $InstallRoot 'install-state.json') -Encoding UTF8
Start-Process (Join-Path $target 'TigerIQ.WorkerUtility.exe')
Write-Output ("INSTALLED|$target|$hash")