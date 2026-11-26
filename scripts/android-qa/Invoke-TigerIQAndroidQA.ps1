param([ValidateSet('Preflight','Packages','CrashLog')][string]$Mode='Preflight')
$ErrorActionPreference='Stop'
$root='D:\TigerIQ\Tools\ApkStart\v0.6.4'
$adb=Join-Path $root 'runtime\platform-tools\adb.exe'
$emulator=Join-Path $root 'runtime\emulator\emulator.exe'
$qemu=Join-Path $root 'runtime\emulator\qemu\windows-x86_64\qemu-system-x86_64-headless.exe'
foreach($bin in @($adb,$emulator,$qemu)){
  $sig=Get-AuthenticodeSignature -LiteralPath $bin
  if($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'CN=Google LLC(?:,|$)'){throw 'QA_RUNTIME_SIGNATURE_INVALID'}
}
$listen=@(Get-NetTCPConnection -LocalPort 5044 -State Listen -ErrorAction SilentlyContinue)
if($listen.Count -ne 1 -or $listen[0].LocalAddress -ne '127.0.0.1'){throw 'QA_ADB_LISTENER_INVALID'}
if((Get-Process -Id $listen[0].OwningProcess).Path -ne $adb){throw 'QA_ADB_PROCESS_INVALID'}
function Invoke-QaAdb([string[]]$Command){
  $output=& $adb -P 5044 -s emulator-5560 @Command
  if($LASTEXITCODE -ne 0){throw 'QA_ADB_COMMAND_FAILED'}
  return $output
}
$devices=@(& $adb -P 5044 devices)
if($LASTEXITCODE -ne 0){throw 'QA_ADB_LIST_FAILED'}
$rows=@($devices | Where-Object {$_ -match '^\S+\s+(device|offline|unauthorized)\s*$'})
if($rows.Count -ne 1 -or $rows[0] -notmatch '^emulator-5560\s+device\s*$'){throw 'QA_ADB_TARGET_INVALID'}
if((Invoke-QaAdb @('shell','getprop','sys.boot_completed')) -ne '1'){throw 'QA_BOOT_NOT_READY'}
if((Invoke-QaAdb @('shell','getprop','ro.adb.secure')) -ne '1' -or (Invoke-QaAdb @('shell','getprop','ro.debuggable')) -ne '0'){throw 'QA_GUEST_SECURITY_INVALID'}
switch($Mode){
 'Preflight' { [pscustomobject]@{ok=$true;port=5044;serial='emulator-5560';android=(Invoke-QaAdb @('shell','getprop','ro.build.version.release'));size=(Invoke-QaAdb @('shell','wm','size'));density=(Invoke-QaAdb @('shell','wm','density'));runtimeSigner='Google LLC';physicalAdbChanged=$false} | ConvertTo-Json -Compress }
 'Packages' { Invoke-QaAdb @('shell','pm','list','packages','-3') }
 'CrashLog' { Invoke-QaAdb @('logcat','-b','crash','-d','-t','10') }
}
