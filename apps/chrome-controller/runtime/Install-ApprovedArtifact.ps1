param(
  [Parameter(Mandatory=$true)][string]$ExpectedHead,
  [Parameter(Mandatory=$true)][string]$ArtifactRoot,
  [switch]$Nv02Only,
  [switch]$ActivateNow,
  [string]$InstallRoot='D:\TigerIQ\Apps\ChromeController'
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$runtime=Join-Path $InstallRoot 'Runtime'
New-Item -ItemType Directory -Path $runtime -Force|Out-Null
$lockPath=Join-Path $runtime 'appchrome-deploy.lock'
$lock=$null
try{
  try{
    $lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  }catch{
    throw 'APPCHROME_DEPLOYMENT_LOCKED'
  }

  $versionPath=Join-Path $ArtifactRoot 'VERSION.txt'
  if(-not(Test-Path $versionPath)){throw "ARTIFACT_VERSION_MISSING:$versionPath"}
  $version=(Get-Content $versionPath -Raw).Trim()
  if($version -ne $ExpectedHead){throw "ARTIFACT_HEAD_MISMATCH:$version"}
  foreach($rel in @(
    'apps\chrome-controller\direct-cdp-bridge.mjs',
    'dist\apps\chrome-controller\src\server.js',
    'dist\apps\chrome-controller\src\chrome-launch-broker.js',
    'apps\chrome-controller\runtime\Start-Unified-AppChrome.ps1'
  )){
    if(-not(Test-Path (Join-Path $ArtifactRoot $rel))){throw "ARTIFACT_REQUIRED_FILE_MISSING:$rel"}
  }

  $short=$ExpectedHead.Substring(0,[Math]::Min(7,$ExpectedHead.Length))
  $deploy=Join-Path $InstallRoot ("Deploy-final-"+$short)
  $stage=$deploy+'.staging'
  if(Test-Path $stage){Remove-Item $stage -Recurse -Force}
  New-Item -ItemType Directory -Path $stage -Force|Out-Null
  Copy-Item (Join-Path $ArtifactRoot '*') $stage -Recurse -Force
  if(Test-Path $deploy){Remove-Item $deploy -Recurse -Force}
  Move-Item $stage $deploy

  $bridge=Join-Path $deploy 'apps\chrome-controller\direct-cdp-bridge.mjs'
  $bridgeHash=(Get-FileHash $bridge -Algorithm SHA256).Hash.ToLowerInvariant()
  $launcherSource=Join-Path $deploy 'apps\chrome-controller\runtime\Start-Unified-AppChrome.ps1'
  $launcherCanonical=Join-Path $runtime 'Start-Unified-AppChrome.ps1'
  $launcherLegacy=Join-Path $runtime 'Start-Unified-AppChrome-1372.ps1'
  Copy-Item $launcherSource $launcherCanonical -Force
  Copy-Item $launcherSource $launcherLegacy -Force

  $taskName='TigerIQ APP Chrome Unified'
  $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  $taskActivation=if($task){'TASK_PRESENT_NEXT_REBOOT'}else{'TASK_ABSENT'}
  try{
    $installedBootId=([DateTime](Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime).ToUniversalTime().ToString('o')
  }catch{
    throw "INSTALL_BOOT_ID_UNAVAILABLE:$($_.Exception.Message)"
  }

  $installedAt=(Get-Date).ToUniversalTime().ToString('o')
  $pendingPath=Join-Path $runtime 'pending-deploy.json'
  $activePath=Join-Path $runtime 'active-deploy.json'
  if($ActivateNow){
    $active=[ordered]@{
      schemaVersion='tigeriq.appchrome.active-deploy.v1'
      exactHead=$ExpectedHead
      nv02Only=[bool]$Nv02Only
      deploy=$deploy
      bridgeSha256=$bridgeHash
      installedAt=$installedAt
      installedBootId=$installedBootId
      activatedAt=$installedAt
      activatedBootId=$installedBootId
      activation='OWNER_ZERO_TOUCH_ACTIVATED'
    }
    $activeTmp=$activePath+'.tmp'
    [IO.File]::WriteAllText($activeTmp,($active|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    Move-Item $activeTmp $activePath -Force
    Remove-Item -LiteralPath $pendingPath -Force -ErrorAction SilentlyContinue
    $activation='OWNER_ZERO_TOUCH_ACTIVATED'
    $taskActivation=if($task){'TASK_PRESENT_RESTART_REQUIRED'}else{'TASK_ABSENT'}
  }else{
    $pending=[ordered]@{
      schemaVersion='tigeriq.appchrome.pending-deploy.v1'
      exactHead=$ExpectedHead
      nv02Only=[bool]$Nv02Only
      deploy=$deploy
      bridgeSha256=$bridgeHash
      installedAt=$installedAt
      installedBootId=$installedBootId
      activation='NEXT_REBOOT_PENDING'
    }
    $pendingTmp=$pendingPath+'.tmp'
    [IO.File]::WriteAllText($pendingTmp,($pending|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    Move-Item $pendingTmp $pendingPath -Force
    $activation='NEXT_REBOOT_PENDING'
  }

  $manifest=[ordered]@{
    ok=$true
    exactHead=$ExpectedHead
    nv02Only=[bool]$Nv02Only
    deploy=$deploy
    bridgeSha256=$bridgeHash
    activeDeploy=$activePath
    pendingDeploy=$pendingPath
    launcher=$launcherLegacy
    activation=$activation
    taskActivation=$taskActivation
    installedAt=$installedAt
    installedBootId=$installedBootId
  }
  $manifestPath=Join-Path $runtime 'artifact-install-final.json'
  [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  # Default stays reboot-gated. -ActivateNow is only consumed by the separately
  # Owner-authorized zero-touch helper, which owns quiesce/restart/rollback.
  $manifest|ConvertTo-Json -Compress
}finally{
  if($lock){$lock.Close();$lock.Dispose()}
}
