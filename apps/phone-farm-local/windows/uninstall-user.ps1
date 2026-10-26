param(
  [string]$Target=(Join-Path $env:LOCALAPPDATA 'TigerIQ\PhoneFarm'),
  [switch]$RemoveData,
  [switch]$NoShortcut
)
$ErrorActionPreference='Stop'
$exe=Join-Path $Target 'TigerIQPhoneFarm.exe'
Get-CimInstance Win32_Process|Where-Object{$_.Name -eq 'TigerIQPhoneFarm.exe' -and $_.ExecutablePath -eq $exe}|ForEach-Object{Stop-Process -Id $_.ProcessId -Force}
if(-not $NoShortcut){
  $shell=New-Object -ComObject WScript.Shell
  $desktop=$shell.SpecialFolders('Desktop')
  if($desktop){
    $shortcutPath=Join-Path $desktop 'TigerIQ Phone Farm.lnk'
    if(Test-Path $shortcutPath){
      $shortcut=$shell.CreateShortcut($shortcutPath)
      if($shortcut.TargetPath -eq $exe){Remove-Item $shortcutPath -Force}
    }
  }
}
$backup=''
if((Test-Path $Target) -and -not $RemoveData){
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup=Join-Path $env:LOCALAPPDATA "TigerIQ\PhoneFarm-Data-$stamp"
  New-Item -ItemType Directory -Path $backup -Force|Out-Null
  foreach($name in @('recordings','drop')){
    $src=Join-Path $Target $name
    if(Test-Path $src){Move-Item $src (Join-Path $backup $name) -Force}
  }
}
if(Test-Path $Target){Remove-Item $Target -Recurse -Force}
Write-Output "UNINSTALLED|DATA_BACKUP=$backup|REMOVE_DATA=$RemoveData"
