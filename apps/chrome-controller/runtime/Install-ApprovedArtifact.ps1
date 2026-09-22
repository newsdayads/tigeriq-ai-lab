param(
  [Parameter(Mandatory=$true)][string]$ExpectedHead,
  [Parameter(Mandatory=$true)][string]$ArtifactRoot,
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
  $taskActivation='TASK_ABSENT'
  if($task){
    $taskUser=[string]$task.Principal.UserId
    if([string]::IsNullOrWhiteSpace($taskUser)){throw 'APPCHROME_TASK_USER_MISSING'}
    $ps='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $taskAction=New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherLegacy`""
    $taskPrincipal=New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Highest
    Set-ScheduledTask -TaskName $taskName -Action $taskAction -Principal $taskPrincipal|Out-Null
    $taskActivation='TASK_CONFIGURED_HIGHEST'
  }

  $active=[ordered]@{
    schemaVersion='tigeriq.appchrome.active-deploy.v1'
    exactHead=$ExpectedHead
    deploy=$deploy
    bridgeSha256=$bridgeHash
    installedAt=(Get-Date).ToUniversalTime().ToString('o')
    activation='SUPERVISOR_PENDING'
  }
  $activeTmp=Join-Path $runtime 'active-deploy.json.tmp'
  $activePath=Join-Path $runtime 'active-deploy.json'
  [IO.File]::WriteAllText($activeTmp,($active|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  Move-Item $activeTmp $activePath -Force

  $manifest=[ordered]@{
    ok=$true
    exactHead=$ExpectedHead
    deploy=$deploy
    bridgeSha256=$bridgeHash
    activeDeploy=$activePath
    launcher=$launcherLegacy
    activation='SUPERVISOR_PENDING'
    taskActivation=$taskActivation
    installedAt=$active.installedAt
  }
  $manifestPath=Join-Path $runtime 'artifact-install-final.json'
  [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  if($task){
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $taskName
    $taskActivation='TASK_RESTARTED'
    $manifest.taskActivation=$taskActivation
    [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  }
  $manifest|ConvertTo-Json -Compress
}finally{
  if($lock){$lock.Close();$lock.Dispose()}
}
