param(
  [Parameter(Mandatory=$true)][string]$ManifestUri,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedManifestSha256,
  [string]$ExtensionPathOverride = '',
  [switch]$PreflightOnly
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$script:ExtensionId=''
$script:TargetVersion=''
$script:ChromeWasRunning=$false
$script:ChromeExe=$null
$script:BackupPath=$null
$script:StagePath=$null
$script:ExtensionPath=$null
$script:Swapped=$false
$script:InPlaceApplied=$false
$script:ReloadAttempted=$false
$script:RollbackPerformed=$false
$script:StatusPath=Join-Path $env:LOCALAPPDATA 'TigerIQ\AutoWorker\zero-touch-status.json'

function Write-Utf8NoBom([string]$Path,[string]$Text){
  $enc=New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path,$Text,$enc)
}
function Write-Status([bool]$Ok,[string]$Phase,[string]$ReloadMode,[string]$Message,[string]$ManifestSha,[string]$SourceCommit,[string]$Version){
  try{
    $dir=Split-Path -Parent $script:StatusPath
    if(-not(Test-Path $dir)){New-Item -ItemType Directory -Force -Path $dir|Out-Null}
    $obj=[ordered]@{
      schema_version=1
      ok=$Ok
      phase=$Phase
      version=$Version
      extension_id=$script:ExtensionId
      source_commit=$SourceCommit
      manifest_sha256=$ManifestSha
      chrome_running=$script:ChromeWasRunning
      reload_mode=$ReloadMode
      rolled_back=$script:RollbackPerformed
      message=$Message
      updated_at=(Get-Date).ToUniversalTime().ToString('o')
    }
    Write-Utf8NoBom $script:StatusPath ($obj|ConvertTo-Json -Depth 5)
  }catch{}
}
function Get-Sha256([string]$Path){
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}
function Get-GitBlobSha1([string]$Path){
  $bytes=[IO.File]::ReadAllBytes($Path)
  $prefix=[Text.Encoding]::UTF8.GetBytes(('blob '+$bytes.Length+[char]0))
  $all=New-Object byte[] ($prefix.Length+$bytes.Length)
  [Array]::Copy($prefix,0,$all,0,$prefix.Length)
  [Array]::Copy($bytes,0,$all,$prefix.Length,$bytes.Length)
  $sha=[Security.Cryptography.SHA1]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash($all))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Get-KeyDerivedId([string]$Key){
  if([string]::IsNullOrWhiteSpace($Key)){return $null}
  try{
    $b=[Convert]::FromBase64String($Key)
    $h=[Security.Cryptography.SHA256]::Create().ComputeHash($b)
    $c='abcdefghijklmnop'
    $s=New-Object Text.StringBuilder
    for($i=0;$i-lt16;$i++){
      [void]$s.Append($c[($h[$i]-shr4)-band15])
      [void]$s.Append($c[$h[$i]-band15])
    }
    return $s.ToString()
  }catch{return $null}
}
function Resolve-Manifest([string]$Source,[string]$Destination){
  if(Test-Path -LiteralPath $Source -PathType Leaf){
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
  }else{
    $u=$null
    if(-not[Uri]::TryCreate($Source,[UriKind]::Absolute,[ref]$u)){throw 'MANIFEST_URI_INVALID'}
    if($u.Scheme-ne'https'){throw 'MANIFEST_URI_MUST_BE_HTTPS_OR_LOCAL_FILE'}
    Invoke-WebRequest -UseBasicParsing -Uri $u.AbsoluteUri -OutFile $Destination
  }
}
function Assert-Manifest($Manifest){
  if([int]$Manifest.schema_version-ne1){throw 'MANIFEST_SCHEMA_UNSUPPORTED'}
  if(([string]$Manifest.repo)-ne'newsdayads/tigeriq-ai-lab'){throw 'MANIFEST_REPO_NOT_ALLOWED'}
  if(([string]$Manifest.source_commit)-notmatch'^[0-9a-f]{40}$'){throw 'MANIFEST_SOURCE_COMMIT_INVALID'}
  if(([string]$Manifest.extension_id)-notmatch'^[a-p]{32}$'){throw 'MANIFEST_EXTENSION_ID_INVALID'}
  if(([string]$Manifest.target_version)-notmatch'^\d+\.\d+\.\d+(?:\.\d+)?$'){throw 'MANIFEST_VERSION_INVALID'}
  if(@($Manifest.payloads).Count-lt1){throw 'MANIFEST_PAYLOAD_EMPTY'}
  foreach($p in @($Manifest.payloads)){
    if(([string]$p.source_path)-notmatch'^[A-Za-z0-9._/\-]+$'){throw 'PAYLOAD_SOURCE_PATH_INVALID'}
    if(([string]$p.source_path).Contains('..')){throw 'PAYLOAD_SOURCE_PATH_TRAVERSAL'}
    if(([string]$p.git_blob_sha1)-notmatch'^[0-9a-f]{40}$'){throw 'PAYLOAD_GIT_BLOB_SHA1_INVALID'}
    if(([string]$p.kind)-notin@('service_worker_template','file')){throw 'PAYLOAD_KIND_INVALID'}
    if(([string]$p.kind)-eq'file'){
      if(([string]$p.target)-notmatch'^[A-Za-z0-9._/\-]+$'-or([string]$p.target).Contains('..')){throw 'PAYLOAD_TARGET_INVALID'}
    }
  }
}
function Test-ExtensionPath([string]$Path,[string]$ExpectedId){
  try{
    if([string]::IsNullOrWhiteSpace($Path)){return $false}
    $full=[IO.Path]::GetFullPath($Path)
    $mp=Join-Path $full 'manifest.json'
    if(-not(Test-Path -LiteralPath $mp -PathType Leaf)){return $false}
    $m=Get-Content -Raw -LiteralPath $mp|ConvertFrom-Json
    if(([string]$m.name)-notmatch'TigerIQ Auto Worker'){return $false}
    $kp=$m.PSObject.Properties['key']
    if($null-eq$kp){return $false}
    $derivedId=Get-KeyDerivedId ([string]$kp.Value)
    return ($derivedId-eq$ExpectedId)
  }catch{return $false}
}
function Find-ExtensionPath([string]$ExpectedId){
  $candidates=New-Object Collections.Generic.List[string]
  $ud=Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
  if(Test-Path $ud){
    $profiles=Get-ChildItem -LiteralPath $ud -Directory -ErrorAction SilentlyContinue|Where-Object{$_.Name-eq'Default'-or$_.Name-like'Profile *'}
    foreach($profile in $profiles){
      foreach($prefName in @('Preferences','Secure Preferences')){
        $pref=Join-Path $profile.FullName $prefName
        if(-not(Test-Path $pref)){continue}
        try{
          $j=Get-Content -Raw -LiteralPath $pref|ConvertFrom-Json
          $settings=$j.extensions.settings
          if($null-eq$settings){continue}
          $prop=$settings.PSObject.Properties[$ExpectedId]
          if($null-eq$prop){continue}
          $pathProp=$prop.Value.PSObject.Properties['path']
          if($null-eq$pathProp-or[string]::IsNullOrWhiteSpace([string]$pathProp.Value)){continue}
          $x=[string]$pathProp.Value
          if(-not[IO.Path]::IsPathRooted($x)){$x=Join-Path $profile.FullName $x}
          if(Test-ExtensionPath $x $ExpectedId){$candidates.Add([IO.Path]::GetFullPath($x))}
        }catch{}
      }
    }
  }
  foreach($x in @('C:\TigerIQ\AutoResumeV6\extension','D:\TigerIQ\AutoResumeV6\extension','F:\TigerIQ\AutoResumeV6\extension','C:\TigerIQ\AutoWorker\extension','D:\TigerIQ\AutoWorker\extension','F:\TigerIQ\AutoWorker\extension')){
    if(Test-ExtensionPath $x $ExpectedId){$candidates.Add([IO.Path]::GetFullPath($x))}
  }
  $u=@($candidates|Select-Object -Unique)
  if($u.Count-eq0){throw ('EXTENSION_PATH_NOT_FOUND_FOR_ID_'+$ExpectedId)}
  if($u.Count-gt1){throw ('EXTENSION_PATH_AMBIGUOUS '+($u-join' | '))}
  return [string]$u[0]
}
function Get-ChromeExecutable{
  try{
    $p=Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue|Select-Object -First 1
    if($null-ne$p -and -not [string]::IsNullOrWhiteSpace([string]$p.ExecutablePath) -and (Test-Path $p.ExecutablePath)){return [string]$p.ExecutablePath}
  }catch{}
  foreach($x in @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")){
    if($x -and (Test-Path $x)){return $x}
  }
  return $null
}
function Get-ChromeDocuments{
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $docs=New-Object Collections.Generic.List[object]
  foreach($p in @(Get-Process chrome -ErrorAction SilentlyContinue)){
    if($p.MainWindowHandle-eq0){continue}
    try{
      $w=[Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
      $docs.Add($w)
    }catch{}
  }
  return $docs.ToArray()
}
function Invoke-ReloadAndConfirm([string]$ExpectedVersion){
  if(-not$script:ChromeWasRunning){return @{Ok=$true;Mode='CHROME_NOT_RUNNING_ON_DISK_ONLY'}}
  if([string]::IsNullOrWhiteSpace($script:ChromeExe)-or-not(Test-Path $script:ChromeExe)){return @{Ok=$false;Mode='CHROME_EXE_NOT_FOUND'}}
  $target=@(Get-Process chrome -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0}|Select-Object -First 1)
  if($target.Count-eq0){return @{Ok=$false;Mode='CHROME_WINDOW_NOT_FOUND'}}
  try{
    $ws=New-Object -ComObject WScript.Shell
    if(-not$ws.AppActivate($target[0].Id)){return @{Ok=$false;Mode='CHROME_WINDOW_ACTIVATE_FAILED'}}
    Start-Sleep -Milliseconds 350
    $ws.SendKeys('^l');Start-Sleep -Milliseconds 150
    $ws.SendKeys('chrome://extensions/?id='+$script:ExtensionId);$ws.SendKeys('{ENTER}')
  }catch{return @{Ok=$false;Mode='CHROME_INTERNAL_NAV_FAILED'}}
  $script:ReloadAttempted=$true
  Start-Sleep -Seconds 2
  $clicked=$false
  for($r=0;$r-lt6-and-not$clicked;$r++){
    foreach($doc in @(Get-ChromeDocuments)){
      try{
        $cond=New-Object Windows.Automation.PropertyCondition -ArgumentList @([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
        $reloadCandidates=New-Object Collections.Generic.List[object]
        foreach($b in $doc.FindAll([Windows.Automation.TreeScope]::Subtree,$cond)){
          $n=[string]$b.Current.Name
          $aid=[string]$b.Current.AutomationId
          if($aid-eq'dev-reload-button'-or$n-match'(?i)^\s*(reload|reload extension|tai lai|tai lai tien ich)\s*$'){$reloadCandidates.Add($b)}
        }
        foreach($b in @($reloadCandidates.ToArray()|Sort-Object { $_.Current.BoundingRectangle.Y } -Descending)){
          try{$b.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke();$clicked=$true;break}catch{}
        }
      }catch{}
      if($clicked){break}
    }
    if(-not$clicked){Start-Sleep -Milliseconds 750}
  }
  if(-not$clicked){return @{Ok=$false;Mode='RELOAD_UI_BUTTON_NOT_FOUND'}}
  if([string]::IsNullOrWhiteSpace($ExpectedVersion)){return @{Ok=$true;Mode='ROLLBACK_RELOAD_CLICKED'}}
  Start-Sleep -Seconds 2
  $seen=$false
  for($r=0;$r-lt6-and-not$seen;$r++){
    foreach($doc in @(Get-ChromeDocuments)){
      try{
        foreach($e in $doc.FindAll([Windows.Automation.TreeScope]::Subtree,[Windows.Automation.Condition]::TrueCondition)){
          try{if(([string]$e.Current.Name)-match[regex]::Escape($ExpectedVersion)){$seen=$true;break}}catch{}
        }
      }catch{}
      if($seen){break}
    }
    if(-not$seen){Start-Sleep -Milliseconds 750}
  }
  if(-not$seen){return @{Ok=$false;Mode='CHROME_UI_VERSION_NOT_CONFIRMED'}}
  return @{Ok=$true;Mode='CHROME_UI_VERSION_CONFIRMED'}
}
function Apply-Replacements([string]$Text,$Replacements){
  $out=$Text
  foreach($r in @($Replacements)){
    $from=[string]$r.from
    $to=[string]$r.to
    if([string]::IsNullOrEmpty($from)){throw 'REPLACEMENT_FROM_EMPTY'}
    if(-not$out.Contains($from)){throw ('REPLACEMENT_SOURCE_NOT_FOUND '+$from)}
    $out=$out.Replace($from,$to)
  }
  return $out
}
function Ensure-ContentScript($ManifestJson,$Patch){
  $match=[string]$Patch.ensure_content_script_match
  $prepend=@($Patch.prepend_js)
  $found=$false
  foreach($cs in @($ManifestJson.content_scripts)){
    if(@($cs.matches)-contains$match){
      $js=@($cs.js)
      foreach($name in @($prepend)){
        if($js-notcontains[string]$name){$js=@([string]$name)+$js}
      }
      $cs.js=$js
      $found=$true
    }
  }
  if(-not$found){throw 'CHATGPT_CONTENT_SCRIPT_NOT_FOUND_FAIL_CLOSED'}
}
function Assert-Health([string]$Path,$Spec,[string]$ExpectedId,[string]$ExpectedVersion){
  $mp=Join-Path $Path 'manifest.json'
  $m=Get-Content -Raw -LiteralPath $mp|ConvertFrom-Json
  if([string]$m.version-ne$ExpectedVersion){throw 'HEALTH_VERSION_MISMATCH'}
  $keyProp=$m.PSObject.Properties['key']
  if($null-eq$keyProp){throw 'HEALTH_EXTENSION_KEY_MISSING'}
  $derivedId=Get-KeyDerivedId ([string]$keyProp.Value)
  if($derivedId-ne$ExpectedId){throw ('HEALTH_EXTENSION_ID_MISMATCH expected='+$ExpectedId+' derived='+$derivedId)}
  $swRel=([string]$m.background.service_worker).Replace('/',[IO.Path]::DirectorySeparatorChar)
  $sw=Join-Path $Path $swRel
  if(-not(Test-Path -LiteralPath $sw -PathType Leaf)){throw 'HEALTH_SERVICE_WORKER_MISSING'}
  if((Get-Content -Raw -LiteralPath $sw)-notmatch[regex]::Escape([string]$Spec.service_worker_marker)){throw 'HEALTH_SERVICE_WORKER_MARKER_MISSING'}
  $guard=Join-Path $Path ([string]$Spec.guard_file)
  if(-not(Test-Path -LiteralPath $guard -PathType Leaf)){throw 'HEALTH_GUARD_MISSING'}
  if((Get-Content -Raw -LiteralPath $guard)-notmatch[regex]::Escape([string]$Spec.guard_marker)){throw 'HEALTH_GUARD_MARKER_MISSING'}
  $reg=Get-Content -Raw -LiteralPath (Join-Path $Path ([string]$Spec.registry_file))|ConvertFrom-Json
  $a=$Spec.registry_authority
  if([int]$reg.source_issue-ne[int]$a.source_issue-or[int]$reg.central_issue-ne[int]$a.central_issue-or[int]$reg.activation_gate_issue-ne[int]$a.activation_gate_issue){throw 'HEALTH_REGISTRY_AUTHORITY_MISMATCH'}
  foreach($id in @($Spec.active_background_employee_ids)){
    $p=@($reg.employees|Where-Object{$_.employee_id-eq[string]$id})[0]
    if($null-eq$p -or -not $p.runtime_active -or -not $p.active -or $p.activation_state-ne'ACTIVE'){throw ('HEALTH_ACTIVE_EMPLOYEE_INVALID '+$id)}
  }
  foreach($id in @($Spec.inactive_background_employee_ids)){
    $p=@($reg.employees|Where-Object{$_.employee_id-eq[string]$id})[0]
    if($null-eq$p -or $p.runtime_active -or $p.active){throw ('HEALTH_INACTIVE_EMPLOYEE_INVALID '+$id)}
  }
}
function Sync-Tree([string]$Source,[string]$Destination){
  if(-not(Test-Path -LiteralPath $Destination)){New-Item -ItemType Directory -Force -Path $Destination|Out-Null}
  & robocopy $Source $Destination /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  $rc=$LASTEXITCODE
  if($rc-ge8){throw ('ROBOCOPY_SYNC_FAILED exit='+$rc)}
}
function Restore-Backup{
  if([string]::IsNullOrWhiteSpace($script:BackupPath)-or[string]::IsNullOrWhiteSpace($script:ExtensionPath)){return}
  if($script:InPlaceApplied){
    Sync-Tree $script:BackupPath $script:ExtensionPath
    $script:InPlaceApplied=$false
  }elseif($script:Swapped){
    $failed=$script:ExtensionPath+'.failed.'+(Get-Date -Format 'yyyyMMddHHmmssfff')
    if(Test-Path -LiteralPath $script:ExtensionPath){Move-Item -LiteralPath $script:ExtensionPath -Destination $failed -Force}
    Move-Item -LiteralPath $script:BackupPath -Destination $script:ExtensionPath -Force
    $script:Swapped=$false
  }else{return}
  $script:RollbackPerformed=$true
  if($script:ChromeWasRunning-and$script:ReloadAttempted){try{[void](Invoke-ReloadAndConfirm '')}catch{}}
}

$tmpRoot=Join-Path $env:TEMP ('TigerIQ_AW_ZT_'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpRoot|Out-Null
$lockPath=Join-Path $env:TEMP 'TigerIQ_AW_ZERO_TOUCH.lock'
$lock=$null
try{
  $lock=New-Object IO.FileStream($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  $manifestPath=Join-Path $tmpRoot 'manifest.json'
  Resolve-Manifest $ManifestUri $manifestPath
  if((Get-Sha256 $manifestPath)-ne$ExpectedManifestSha256.ToLowerInvariant()){throw 'MANIFEST_SHA256_MISMATCH'}
  $manifest=Get-Content -Raw -LiteralPath $manifestPath|ConvertFrom-Json
  Assert-Manifest $manifest
  $script:ExtensionId=[string]$manifest.extension_id
  $script:TargetVersion=[string]$manifest.target_version
  Write-Status $false 'STAGING' '' 'validated pinned manifest' $ExpectedManifestSha256.ToLowerInvariant() ([string]$manifest.source_commit) $script:TargetVersion

  $script:ExtensionPath=if([string]::IsNullOrWhiteSpace($ExtensionPathOverride)){Find-ExtensionPath $script:ExtensionId}else{[IO.Path]::GetFullPath($ExtensionPathOverride)}
  if(-not(Test-ExtensionPath $script:ExtensionPath $script:ExtensionId)){throw 'EXTENSION_PATH_ID_VALIDATION_FAILED'}
  $currentManifest=Get-Content -Raw -LiteralPath (Join-Path $script:ExtensionPath 'manifest.json')|ConvertFrom-Json
  $oldVersion=[string]$currentManifest.version
  $oldKey=[string]$currentManifest.key
  $currentDerivedId=Get-KeyDerivedId $oldKey
  if($currentDerivedId-ne$script:ExtensionId){throw ('CURRENT_EXTENSION_KEY_ID_MISMATCH expected='+$script:ExtensionId+' derived='+$currentDerivedId)}

  $parent=Split-Path -Parent $script:ExtensionPath
  $leaf=Split-Path -Leaf $script:ExtensionPath
  $script:StagePath=Join-Path $parent ($leaf+'.tiq_stage.'+[guid]::NewGuid().ToString('N'))
  $script:BackupPath=Join-Path $parent ($leaf+'.tiq_backup.'+(Get-Date -Format 'yyyyMMddHHmmssfff'))
  Copy-Item -LiteralPath $script:ExtensionPath -Destination $script:StagePath -Recurse -Force

  $rawBase='https://raw.githubusercontent.com/'+[string]$manifest.repo+'/'+[string]$manifest.source_commit+'/'
  $stagedManifestPath=Join-Path $script:StagePath 'manifest.json'
  $stagedManifest=Get-Content -Raw -LiteralPath $stagedManifestPath|ConvertFrom-Json
  $swRel=([string]$stagedManifest.background.service_worker).Replace('/',[IO.Path]::DirectorySeparatorChar)
  if([string]::IsNullOrWhiteSpace($swRel)){throw 'SERVICE_WORKER_PATH_MISSING'}
  $swPath=Join-Path $script:StagePath $swRel
  if(-not(Test-Path -LiteralPath $swPath -PathType Leaf)){throw 'SERVICE_WORKER_NOT_FOUND'}
  $currentSw=Get-Content -Raw -LiteralPath $swPath
  $legacyRel=$null
  if($currentSw-match'TIQ142_WRAPPER'){
    $m=[regex]::Match($currentSw,"const LEGACY_REL = '([^']+)';")
    if(-not$m.Success){throw 'EXISTING_WRAPPER_LEGACY_REL_NOT_FOUND'}
    $legacyRel=$m.Groups[1].Value
    if(-not(Test-Path -LiteralPath (Join-Path $script:StagePath ($legacyRel.Replace('/',[IO.Path]::DirectorySeparatorChar))) -PathType Leaf)){throw 'EXISTING_WRAPPER_LEGACY_FILE_MISSING'}
  }else{
    $swDir=Split-Path -Parent $swPath
    $swBase=[IO.Path]::GetFileNameWithoutExtension((Split-Path -Leaf $swPath))
    $legacyFile=$swBase+'.tigeriq_legacy_zt_'+($oldVersion-replace'[^0-9A-Za-z]+','_')+'.js'
    Copy-Item -LiteralPath $swPath -Destination (Join-Path $swDir $legacyFile) -Force
    $relDir=Split-Path -Parent ([string]$stagedManifest.background.service_worker)
    $legacyRel=if([string]::IsNullOrWhiteSpace($relDir)){$legacyFile}else{(($relDir-replace'[\\/]+$','')+'/'+$legacyFile)}
  }

  foreach($p in @($manifest.payloads)){
    $download=Join-Path $tmpRoot ([guid]::NewGuid().ToString('N')+'.payload')
    Invoke-WebRequest -UseBasicParsing -Uri ($rawBase+[string]$p.source_path) -OutFile $download
    if((Get-GitBlobSha1 $download)-ne([string]$p.git_blob_sha1).ToLowerInvariant()){throw ('PAYLOAD_PROVENANCE_MISMATCH '+[string]$p.source_path)}
    $text=Get-Content -Raw -LiteralPath $download
    $text=Apply-Replacements $text $p.replacements
    if(([string]$p.kind)-eq'service_worker_template'){
      if(-not$text.Contains('__LEGACY_REL__')){throw 'SERVICE_WORKER_TEMPLATE_PLACEHOLDER_MISSING'}
      $text=$text.Replace('__LEGACY_REL__',$legacyRel.Replace('\','/').Replace("'",''))
      Write-Utf8NoBom $swPath $text
    }else{
      $target=Join-Path $script:StagePath (([string]$p.target).Replace('/',[IO.Path]::DirectorySeparatorChar))
      $targetFull=[IO.Path]::GetFullPath($target)
      $rootFull=[IO.Path]::GetFullPath($script:StagePath)+[IO.Path]::DirectorySeparatorChar
      if(-not$targetFull.StartsWith($rootFull,[StringComparison]::OrdinalIgnoreCase)){throw 'PAYLOAD_TARGET_ESCAPES_EXTENSION'}
      $td=Split-Path -Parent $targetFull
      if(-not(Test-Path $td)){New-Item -ItemType Directory -Force -Path $td|Out-Null}
      Write-Utf8NoBom $targetFull $text
    }
  }

  $stagedManifest=Get-Content -Raw -LiteralPath $stagedManifestPath|ConvertFrom-Json
  $stagedManifest.version=$script:TargetVersion
  $stagedManifest.description=[string]$manifest.manifest_patch.description
  Ensure-ContentScript $stagedManifest $manifest.manifest_patch
  Write-Utf8NoBom $stagedManifestPath ($stagedManifest|ConvertTo-Json -Depth 100)
  $verifyManifest=Get-Content -Raw -LiteralPath $stagedManifestPath|ConvertFrom-Json
  if([string]$verifyManifest.key-ne$oldKey){throw 'EXTENSION_KEY_CHANGED_IN_STAGE'}
  Assert-Health $script:StagePath $manifest.health $script:ExtensionId $script:TargetVersion

  if($PreflightOnly){
    Write-Status $true 'PREFLIGHT_PASS' 'NOT_APPLIED' 'pinned manifest, provenance, stage and health checks passed' $ExpectedManifestSha256.ToLowerInvariant() ([string]$manifest.source_commit) $script:TargetVersion
    Write-Host ('PASS: zero-touch preflight target='+$script:TargetVersion+' current='+$oldVersion+' manifest_sha256='+$ExpectedManifestSha256.ToLowerInvariant())
    exit 0
  }

  $script:ChromeWasRunning=@(Get-Process chrome -ErrorAction SilentlyContinue).Count-gt0
  $script:ChromeExe=Get-ChromeExecutable

  if($script:ChromeWasRunning){
    Copy-Item -LiteralPath $script:ExtensionPath -Destination $script:BackupPath -Recurse -Force
    Sync-Tree $script:StagePath $script:ExtensionPath
    $script:InPlaceApplied=$true
  }else{
    Move-Item -LiteralPath $script:ExtensionPath -Destination $script:BackupPath
    try{
      Move-Item -LiteralPath $script:StagePath -Destination $script:ExtensionPath
      $script:StagePath=$null
      $script:Swapped=$true
    }catch{
      Move-Item -LiteralPath $script:BackupPath -Destination $script:ExtensionPath -Force
      throw
    }
  }

  Assert-Health $script:ExtensionPath $manifest.health $script:ExtensionId $script:TargetVersion
  $reload=Invoke-ReloadAndConfirm $script:TargetVersion
  if(-not$reload.Ok){throw ('RELOAD_HEALTH_FAILED '+$reload.Mode)}
  Assert-Health $script:ExtensionPath $manifest.health $script:ExtensionId $script:TargetVersion
  $script:Swapped=$false
  $script:InPlaceApplied=$false

  Write-Status $true 'APPLIED' ([string]$reload.Mode) ('updated '+$oldVersion+' -> '+$script:TargetVersion) $ExpectedManifestSha256.ToLowerInvariant() ([string]$manifest.source_commit) $script:TargetVersion
  Write-Host ('PASS: zero-touch update '+$oldVersion+' -> '+$script:TargetVersion+'; chrome_running='+$script:ChromeWasRunning+'; reload='+$reload.Mode)
  Write-Host ('EVIDENCE manifest_sha256='+$ExpectedManifestSha256.ToLowerInvariant()+' source_commit='+[string]$manifest.source_commit+' extension_id='+$script:ExtensionId)
  exit 0
}catch{
  $msg=$_.Exception.Message
  try{Restore-Backup}catch{}
  $sc='';$tv=$script:TargetVersion
  try{if($manifest){$sc=[string]$manifest.source_commit}}catch{}
  Write-Status $false 'FAILED' '' $msg $ExpectedManifestSha256.ToLowerInvariant() $sc $tv
  Write-Host ('FAIL: '+$msg) -ForegroundColor Red
  exit 41
}finally{
  if($lock){$lock.Dispose()}
  if($script:StagePath-and(Test-Path -LiteralPath $script:StagePath)){Remove-Item -LiteralPath $script:StagePath -Recurse -Force -ErrorAction SilentlyContinue}
  if(Test-Path -LiteralPath $tmpRoot){Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue}
}
