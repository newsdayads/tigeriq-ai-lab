# Install a LIMITED user-context task for the Owner AI CLI bridge.
# This is NOT an Administrator grant. SYSTEM Core invokes a constrained user-session adapter.
# No password, access token, general shell or credential contents are created or stored.
$ErrorActionPreference='Stop'
$TaskName='TigerIQ Owner AI Session'
$Root='C:\ProgramData\TigerIQOwnerAiBridge'
$Worker='D:\TigerIQ\Runtime\CoreSource\apps\tigeriq-core\owner-cli-user-worker.mjs'
$Node='C:\Program Files\nodejs\node.exe'
$EvidenceDir='D:\TigerIQ\Evidence'
$Expected='PC01\wdragons12x'
$Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$Principal=[Security.Principal.WindowsPrincipal]$Identity
if($Identity.Name -ine $Expected){throw 'OWNER_AI_SESSION_USER_MISMATCH'}
if($Identity.User.Value -eq 'S-1-5-18'){throw 'OWNER_AI_SESSION_SYSTEM_DENIED'}
if($Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  throw 'OWNER_AI_SESSION_MUST_NOT_RUN_ELEVATED'
}
if(-not(Test-Path -LiteralPath $Worker -PathType Leaf)){throw 'OWNER_AI_SESSION_SIGNED_WORKER_NOT_INSTALLED'}
if(-not(Test-Path -LiteralPath $Node -PathType Leaf)){throw 'OWNER_AI_SESSION_NODE_MISSING'}
$Created=$false
if(-not(Test-Path -LiteralPath $Root)){
  New-Item -ItemType Directory -Path $Root -ErrorAction Stop|Out-Null
  $Created=$true
}
$item=Get-Item -LiteralPath $Root -Force
if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){
  throw 'OWNER_AI_SESSION_ROOT_UNTRUSTED'
}
$Acl=Get-Acl -LiteralPath $Root
if($Created){
  $Acl.SetAccessRuleProtection($true,$false)
  foreach($rule in @($Acl.Access)){$Acl.RemoveAccessRuleSpecific($rule)|Out-Null}
  $inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  $prop=[Security.AccessControl.PropagationFlags]::None
  $type=[Security.AccessControl.AccessControlType]::Allow
  foreach($account in @($Expected,'NT AUTHORITY\SYSTEM','BUILTIN\Administrators')){
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($account,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,$prop,$type)
    $Acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Root -AclObject $Acl -ErrorAction Stop
}
$Acl=Get-Acl -LiteralPath $Root
$AllowedSids=@(
  $Identity.User.Value,
  'S-1-5-18',
  'S-1-5-32-544'
)
if(-not $Acl.AreAccessRulesProtected){throw 'OWNER_AI_SESSION_ACL_INHERITED'}
foreach($entry in @($Acl.Access)){
  if($entry.AccessControlType -ne 'Allow'){continue}
  $sid=$entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
  if($sid -notin $AllowedSids){throw 'OWNER_AI_SESSION_ACL_WRITER_UNTRUSTED'}
}
$Existing=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$Args='"'+$Worker+'"'
if($Existing){
  if(@($Existing.Actions).Count -ne 1){throw 'OWNER_AI_SESSION_TASK_ACTION_COUNT'}
  $Action=@($Existing.Actions)[0]
  $ExistingSid=([Security.Principal.NTAccount]::new([string]$Existing.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
  if($ExistingSid -ne $Identity.User.Value -or
     [string]$Existing.Principal.RunLevel -notin @('Limited','0') -or
     [IO.Path]::GetFullPath([string]$Action.Execute) -ine [IO.Path]::GetFullPath($Node) -or
     [string]$Action.Arguments -ne $Args){
    throw 'OWNER_AI_SESSION_TASK_MISMATCH'
  }
}else{
  $Action=New-ScheduledTaskAction -Execute $Node -Argument $Args
  $TaskPrincipal=New-ScheduledTaskPrincipal -UserId $Expected -LogonType Interactive -RunLevel Limited
  $Settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Principal $TaskPrincipal -Settings $Settings -ErrorAction Stop|Out-Null
}
$Task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$Receipt=[ordered]@{
 schema='TIGERIQ_OWNER_AI_SESSION_INSTALL_V1'
 accepted=$true
 user=$Identity.Name
 elevated=$false
 task=$TaskName
 taskRunLevel=[string]$Task.Principal.RunLevel
 createdRoot=$Created
 aclProtected=[bool]$Acl.AreAccessRulesProtected
 sourceWorker=$Worker
 startedAt=(Get-Date).ToUniversalTime().ToString('o')
}
$Path=Join-Path $EvidenceDir 'gh5744-owner-cli-user-session-install.json'
$Receipt | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $Path -Encoding UTF8
$Receipt|ConvertTo-Json -Depth 6 -Compress
