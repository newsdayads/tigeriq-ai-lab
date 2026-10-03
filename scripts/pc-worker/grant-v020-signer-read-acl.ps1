$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$ExpectedUser='pc01\wdragons12x'
$SecretsDir='D:\TigerIQ\Secrets\AndroidSigning'
$Files=@(
  (Join-Path $SecretsDir 'tigeriq-release.jks'),
  (Join-Path $SecretsDir 'signing-password.dpapi.txt'),
  (Join-Path $SecretsDir 'key-alias.txt')
)

function Resolve-AccountSid([string]$account){
  try {
    return ([Security.Principal.NTAccount]$account).Translate([Security.Principal.SecurityIdentifier])
  } catch {
    throw 'V020_SIGNER_ACL_USER_RESOLVE_FAILED'
  }
}

$sid=Resolve-AccountSid $ExpectedUser
$changed=0
foreach($path in $Files){
  if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'V020_SIGNER_ACL_FILE_MISSING'}
  $acl=Get-Acl -LiteralPath $path
  $hasRead=$false
  foreach($rule in $acl.Access){
    try{$ruleSid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier])}catch{continue}
    if($ruleSid.Value -ne $sid.Value){continue}
    if($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){continue}
    $rights=[Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if(($rights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0){$hasRead=$true;break}
  }
  if(-not$hasRead){
    $rule=New-Object Security.AccessControl.FileSystemAccessRule(
      $sid,
      [Security.AccessControl.FileSystemRights]::Read,
      [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $path -AclObject $acl
    $changed++
  }
}

$verified=0
foreach($path in $Files){
  $acl=Get-Acl -LiteralPath $path
  $ok=$false
  foreach($rule in $acl.Access){
    try{$ruleSid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier])}catch{continue}
    if($ruleSid.Value -ne $sid.Value){continue}
    if($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){continue}
    $rights=[Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if(($rights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0){$ok=$true;break}
  }
  if(-not$ok){throw 'V020_SIGNER_ACL_VERIFY_FAILED'}
  $verified++
}

[ordered]@{
  status='ANDROID_V020_SIGNER_ACL_READY'
  account=$ExpectedUser
  sid=$sid.Value
  filesGranted=$verified
  changed=$changed
  rights='Read'
  inheritance='None'
  secretsPrinted=$false
}|ConvertTo-Json -Compress
