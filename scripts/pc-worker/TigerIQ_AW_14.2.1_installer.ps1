$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$script:Version='14.2.1'
$script:ExtensionId='leidfhbpdillakmcbijagelghhilbnpc'
$script:SourceCommit='7c5a1689d33f14d896accf66ea657bf75a230217'
$script:LogDir=Join-Path $env:LOCALAPPDATA 'TigerIQ\AutoWorker'
$script:LogPath=Join-Path $script:LogDir 'V14_2_1_INSTALL.log'
$script:BackupRootBase=Join-Path $script:LogDir 'Backups'
$script:BackupPath=$null;$script:ExtensionPath=$null;$script:ChromeWasRunning=$false;$script:ChromeExe=$null;$script:ReloadAttempted=$false
$rawBase='https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/'+$script:SourceCommit+'/'
$tmp=Join-Path $env:TEMP ('TigerIQ_AW_14.2.1_'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp|Out-Null
try{
  $lib=Join-Path $tmp 'installer_lib.ps1'
  Invoke-WebRequest -UseBasicParsing -Uri ($rawBase+'scripts/pc-worker/TigerIQ_AW_14.2.1_installer_lib.ps1') -OutFile $lib
  if((Get-FileHash -Algorithm SHA256 -LiteralPath $lib).Hash.ToLowerInvariant()-ne'3eef112d3b750b9f51f72d3d9fb8d1e080a97f4a2002336155f3bae31ee4414a'){throw'INSTALLER_LIBRARY_HASH_MISMATCH'}
  . $lib
  if(-not(Test-Path $script:LogDir)){New-Item -ItemType Directory -Force -Path $script:LogDir|Out-Null};Write-Utf8NoBom $script:LogPath ''
  Write-Log 'TIGERIQ AUTO WORKER 14.2.1 TEST CANDIDATE / PHYSICAL PENDING'
  Write-Log ('SOURCE_COMMIT='+$script:SourceCommit);Write-Log ('TARGET_EXTENSION_ID='+$script:ExtensionId)

  $wrapperFile=Join-Path $tmp 'tigeriq_aw_v142_wrapper.js';$guardFile=Join-Path $tmp 'tigeriq_aw_v142_runtime_guard.js';$regFile=Join-Path $tmp 'registry_seed.json'
  Invoke-WebRequest -UseBasicParsing -Uri ($rawBase+'artifacts/auto-worker/v14.2.1/tigeriq_aw_v142_wrapper.js') -OutFile $wrapperFile
  Invoke-WebRequest -UseBasicParsing -Uri ($rawBase+'artifacts/auto-worker/v14.2.1/tigeriq_aw_v142_runtime_guard.js') -OutFile $guardFile
  Invoke-WebRequest -UseBasicParsing -Uri ($rawBase+'artifacts/auto-worker/v14.2.1/registry_seed.json') -OutFile $regFile
  $wrapper=Get-Content -Raw -LiteralPath $wrapperFile;$guard=Get-Content -Raw -LiteralPath $guardFile;$regRaw=Get-Content -Raw -LiteralPath $regFile;$reg=$regRaw|ConvertFrom-Json
  if($wrapper-notmatch'TIQ142_WRAPPER'-or$wrapper-notmatch'14\.2\.1'){throw'WRAPPER_PAYLOAD_INVALID'}
  if($guard-notmatch'TIQ142_RUNTIME_GUARD'-or$guard-notmatch'14\.2\.1'){throw'RUNTIME_GUARD_PAYLOAD_INVALID'}
  if([int]$reg.source_issue-ne335-or[int]$reg.central_issue-ne280-or[int]$reg.activation_gate_issue-ne440){throw'REGISTRY_AUTHORITY_PAYLOAD_INVALID'}
  $nv02=@($reg.employees|Where-Object{$_.employee_id-eq'NV02'})[0];$nv04=@($reg.employees|Where-Object{$_.employee_id-eq'NV04'})[0];$nv05=@($reg.employees|Where-Object{$_.employee_id-eq'NV05'})[0]
  if(-not$nv02.runtime_active-or-not$nv02.active-or$nv02.activation_state-ne'ACTIVE'){throw'NV02_PAYLOAD_AUTHORITY_INVALID'}
  if($nv04.runtime_active-or$nv04.active-or$nv04.activation_state-ne'PENDING_OWNER_ACTIVATION'){throw'NV04_PAYLOAD_AUTHORITY_INVALID'}
  if($nv05.runtime_active-or$nv05.active-or$nv05.activation_state-ne'PENDING_OWNER_ACTIVATION'){throw'NV05_PAYLOAD_AUTHORITY_INVALID'}
  Write-Log 'PAYLOAD_STATIC_VERIFY=PASS'

  $script:ChromeWasRunning=@(Get-Process chrome -ErrorAction SilentlyContinue).Count-gt0;$script:ChromeExe=Get-ChromeExecutable
  Write-Log ('CHROME_RUNNING_BEFORE_INSTALL='+$script:ChromeWasRunning)
  $script:ExtensionPath=Find-ExtensionPath;Write-Log ('EXTENSION_PATH='+$script:ExtensionPath)
  $manifestPath=Join-Path $script:ExtensionPath 'manifest.json';$manifest=Get-Content -Raw -LiteralPath $manifestPath|ConvertFrom-Json;$oldVersion=[string]$manifest.version;$oldKey=if($null-ne$manifest.PSObject.Properties['key']){[string]$manifest.key}else{$null}
  Write-Log ('CURRENT_VERSION='+$oldVersion);Write-Log ('KEY_PRESENT='+(-not[string]::IsNullOrWhiteSpace($oldKey)))
  if($null-eq$manifest.background-or[string]::IsNullOrWhiteSpace([string]$manifest.background.service_worker)){throw'BACKGROUND_SERVICE_WORKER_MISSING'}
  if($null-ne$manifest.background.PSObject.Properties['type']-and[string]$manifest.background.type-eq'module'){throw'MODULE_SERVICE_WORKER_NOT_SUPPORTED_FAIL_CLOSED'}
  Backup-Extension $script:ExtensionPath

  $swRel=([string]$manifest.background.service_worker).Replace('/',[IO.Path]::DirectorySeparatorChar);$swPath=Join-Path $script:ExtensionPath $swRel
  if(-not(Test-Path -LiteralPath $swPath -PathType Leaf)){throw('SERVICE_WORKER_NOT_FOUND '+$swRel)}
  $swDir=Split-Path -Parent $swPath;$swFile=Split-Path -Leaf $swPath;$swBase=[IO.Path]::GetFileNameWithoutExtension($swFile);$legacyFile=$swBase+'.tigeriq_legacy_v1421.js';$legacyPath=Join-Path $swDir $legacyFile;$swRelDir=Split-Path -Parent ([string]$manifest.background.service_worker);$legacyRel=if([string]::IsNullOrWhiteSpace($swRelDir)){$legacyFile}else{(($swRelDir-replace'[\\/]+$','')+'/'+$legacyFile)}
  $currentSw=Get-Content -Raw -LiteralPath $swPath
  if($currentSw-match'TIQ142_WRAPPER'){if(-not(Test-Path $legacyPath)){throw'EXISTING_TIQ142_WRAPPER_WITHOUT_LEGACY_FAIL_CLOSED'};Write-Log'IDEMPOTENT_WRAPPER_REAPPLY legacy_preserved=true'}else{Copy-Item -LiteralPath $swPath -Destination $legacyPath -Force;Write-Log ('LEGACY_SERVICE_WORKER_SAVED='+$legacyRel)}
  $wrapper=$wrapper.Replace('__LEGACY_REL__',$legacyRel.Replace('\','/').Replace("'",''));Write-Utf8NoBom $swPath $wrapper;Write-Utf8NoBom (Join-Path $script:ExtensionPath 'tigeriq_aw_v142_runtime_guard.js') $guard;Write-Utf8NoBom (Join-Path $script:ExtensionPath 'registry_seed.json') $regRaw

  $guardInjected=$false;if($null-ne$manifest.content_scripts){foreach($cs in @($manifest.content_scripts)){if(@($cs.matches)-contains'https://chatgpt.com/*'){$js=@($cs.js);if($js-notcontains'tigeriq_aw_v142_runtime_guard.js'){$cs.js=@('tigeriq_aw_v142_runtime_guard.js')+$js};$guardInjected=$true}}};if(-not$guardInjected){throw'CHATGPT_CONTENT_SCRIPT_NOT_FOUND_FAIL_CLOSED'}
  $manifest.version=$script:Version;$manifest.description=('TigerIQ Auto Worker '+$script:Version+' TEST CANDIDATE - PHYSICAL PENDING');Write-Utf8NoBom $manifestPath ($manifest|ConvertTo-Json -Depth 100)

  $vm=Get-Content -Raw -LiteralPath $manifestPath|ConvertFrom-Json;if([string]$vm.version-ne$script:Version){throw'ON_DISK_MANIFEST_VERSION_VERIFY_FAILED'};$newKey=if($null-ne$vm.PSObject.Properties['key']){[string]$vm.key}else{$null};if($oldKey-ne$newKey){throw'EXTENSION_KEY_CHANGED_ROLLBACK'}
  if((Get-Content -Raw -LiteralPath $swPath)-notmatch'TIQ142_WRAPPER'){throw'SERVICE_WORKER_WRAPPER_VERIFY_FAILED'};if((Get-Content -Raw -LiteralPath (Join-Path $script:ExtensionPath 'tigeriq_aw_v142_runtime_guard.js'))-notmatch'14\.2\.1'){throw'RUNTIME_GUARD_VERIFY_FAILED'}
  Write-Log 'ON_DISK_STATIC_SELF_CHECK=PASS'

  $reload=Invoke-ExtensionReloadAndConfirm $script:Version;Write-Log ('RELOAD_MODE='+$reload.Mode);if(-not$reload.Ok){throw('CHROME_RELOAD_SELF_CHECK_FAILED '+$reload.Mode)}
  if($script:ChromeWasRunning){Write-Log'INSTALL_RESULT=TEST_CANDIDATE_INSTALLED_CHROME_VERSION_CONFIRMED'}else{Write-Log'INSTALL_RESULT=TEST_CANDIDATE_INSTALLED_ON_DISK_CHROME_NOT_STARTED_PHYSICAL_PENDING'}
  Write-Host '';Write-Host 'PASS: TigerIQ Auto Worker 14.2.1 TEST CANDIDATE installed.';Write-Host 'PRE-ACTIVATION: NV02 only. NV04/NV05 NOT activated.';Write-Host ('Log: '+$script:LogPath);exit 0
}catch{
  $msg=$_.Exception.Message
  try{if(Get-Command Write-Log -ErrorAction SilentlyContinue){Write-Log ('FAIL='+$msg)}else{Write-Host ('FAIL: '+$msg)}}catch{}
  try{if(Get-Command Restore-Backup -ErrorAction SilentlyContinue){Restore-Backup}}catch{}
  try{if(Get-Command Invoke-BestEffortRollbackReload -ErrorAction SilentlyContinue){Invoke-BestEffortRollbackReload}}catch{}
  Write-Host '';Write-Host ('FAIL: '+$msg) -ForegroundColor Red;if($script:LogPath){Write-Host ('Log: '+$script:LogPath)};exit 41
}finally{try{Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}catch{}}
