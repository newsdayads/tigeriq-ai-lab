param(
  [string]$Target=(Join-Path $env:LOCALAPPDATA 'TigerIQ\PhoneFarm'),
  [switch]$NoShortcut,
  [switch]$NoAutoStart
)
$ErrorActionPreference='Stop'
$Source=$PSScriptRoot
foreach($required in @('TigerIQPhoneFarm.exe','node.exe','app.mjs','BUILD_MANIFEST.json')){
  if(!(Test-Path (Join-Path $Source $required))){throw "Package missing $required"}
}
$running=Get-CimInstance Win32_Process|Where-Object{$_.Name -eq 'TigerIQPhoneFarm.exe' -and $_.ExecutablePath -eq (Join-Path $Target 'TigerIQPhoneFarm.exe')}
if($running){throw 'Close TigerIQ Phone Farm before install/upgrade.'}
New-Item -ItemType Directory -Path $Target -Force|Out-Null
Get-ChildItem $Source -File|ForEach-Object{Copy-Item $_.FullName (Join-Path $Target $_.Name) -Force}
New-Item -ItemType Directory -Path (Join-Path $Target 'drop'),(Join-Path $Target 'recordings') -Force|Out-Null
$shell=$null
$exe=Join-Path $Target 'TigerIQPhoneFarm.exe'
$shortcutPath=''
if(-not $NoShortcut){
  $shell=New-Object -ComObject WScript.Shell
  $desktop=$shell.SpecialFolders('Desktop')
  $shortcutPath=Join-Path $desktop 'TigerIQ Phone Farm.lnk'
  $shortcut=$shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath=$exe
  $shortcut.WorkingDirectory=$Target
  $shortcut.Description='TigerIQ Phone Farm — local Android controller'
  $shortcut.Save()
}
$autoStartPath=''
if(-not $NoAutoStart){
  if($null -eq $shell){$shell=New-Object -ComObject WScript.Shell}
  $startup=$shell.SpecialFolders('Startup')
  if([string]::IsNullOrWhiteSpace($startup)){throw 'Cannot resolve per-user Startup folder.'}
  $autoStartPath=Join-Path $startup 'TigerIQ Phone Farm.lnk'
  $auto=$shell.CreateShortcut($autoStartPath)
  $auto.TargetPath=$exe
  $auto.WorkingDirectory=$Target
  $auto.Description='TigerIQ Phone Farm — interactive user-session launcher'
  $auto.Save()
}
Write-Output "INSTALLED|TARGET=$Target|SHORTCUT=$shortcutPath|AUTOSTART=$autoStartPath"
