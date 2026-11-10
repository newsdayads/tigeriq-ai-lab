$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$credentialStore='D:\TigerIQ\Rebuild\credential-store.ps1'
function Assert-TrustedCredentialStore {
  if(-not(Test-Path -LiteralPath $credentialStore)){throw 'CREDENTIAL_STORE_MISSING'}
  $unsafeSids=@('S-1-1-0','S-1-5-11','S-1-5-32-545')
  $unsafe=@(Get-Acl -LiteralPath $credentialStore | Select-Object -ExpandProperty Access | Where-Object {
    if($_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){return $false}
    try{$sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value}catch{return $true}
    if($sid -notin $unsafeSids){return $false}
    return [string]$_.FileSystemRights -match 'FullControl|Modify|Write|Delete|ChangePermissions|TakeOwnership'
  })
  if($unsafe.Count){throw 'CREDENTIAL_STORE_ACL_UNTRUSTED'}
}
Assert-TrustedCredentialStore
. $credentialStore
$runtimeRepo='D:\TigerIQ\Runtime\CoreSource'
$runtimeSourceState='C:\ProgramData\TigerIQCoreRelease\State\core-runtime-source.json'
$runtimeReleaseAttempt='C:\ProgramData\TigerIQCoreRelease\core-runtime-release-attempt.json'
function Test-ProtectedReleaseAttemptAcl {
  $trusted=@('S-1-5-18','S-1-5-32-544')
  $writeMask=[System.Security.AccessControl.FileSystemRights]::Write -bor
             [System.Security.AccessControl.FileSystemRights]::Modify -bor
             [System.Security.AccessControl.FileSystemRights]::FullControl -bor
             [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
             [System.Security.AccessControl.FileSystemRights]::TakeOwnership -bor
             [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
  try{
    if(-not [Environment]::OSVersion.Platform.ToString().Equals('Win32NT')){return $false}
    if(-not(Test-Path -LiteralPath $runtimeReleaseAttempt -PathType Leaf)){return $false}
    foreach($path in @((Split-Path -Parent $runtimeReleaseAttempt),$runtimeReleaseAttempt)){
      $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){return $false}
      $acl=Get-Acl -LiteralPath $path -ErrorAction Stop
      if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin $trusted){return $false}
      foreach($ace in @($acl.Access)){
        if([string]$ace.AccessControlType -ne 'Allow'){continue}
        $sid=$ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if($sid -notin $trusted -and ($ace.FileSystemRights -band $writeMask) -ne 0){return $false}
      }
    }
    return $true
  }catch{return $false}
}
function Resolve-TrustedRuntimeRepo {
  $sha=$null
  if(Test-Path -LiteralPath $runtimeSourceState){
    try{$meta=Get-Content -Raw -LiteralPath $runtimeSourceState|ConvertFrom-Json -ErrorAction Stop}catch{throw 'RUNTIME_SOURCE_STATE_INVALID'}
    if([string]$meta.schema -ne 'TIGERIQ_RUNTIME_SOURCE_V1'){throw 'RUNTIME_SOURCE_SCHEMA_INVALID'}
    if([string]$meta.sourcePath -ne $runtimeRepo){throw 'RUNTIME_SOURCE_PATH_UNTRUSTED'}
    $sha=[string]$meta.currentSha
    if($sha -notmatch '^[0-9a-f]{40}$'){throw 'RUNTIME_SOURCE_SHA_INVALID'}
  }else{
    # One-time bootstrap bridge for the protected-state migration. Trust only the
    # SYSTEM/Administrators-owned release attempt written by the installed guard.
    if(-not(Test-Path -LiteralPath $runtimeReleaseAttempt)){throw 'RUNTIME_SOURCE_STATE_MISSING'}
    if(-not(Test-ProtectedReleaseAttemptAcl)){throw 'RUNTIME_RELEASE_ATTEMPT_ACL_UNTRUSTED'}
    try{$attempt=Get-Content -Raw -LiteralPath $runtimeReleaseAttempt|ConvertFrom-Json -ErrorAction Stop}catch{throw 'RUNTIME_RELEASE_ATTEMPT_INVALID'}
    if([string]$attempt.schema -ne 'TIGERIQ_PC01_RELEASE_ATTEMPT_V1' -or [string]$attempt.result -ne 'STARTED'){
      throw 'RUNTIME_RELEASE_ATTEMPT_NOT_INFLIGHT'
    }
    $sha=[string]$attempt.targetSha
    if($sha -notmatch '^[0-9a-f]{40}$' -or [string]$attempt.previousSha -notmatch '^[0-9a-f]{40}$'){
      throw 'RUNTIME_RELEASE_ATTEMPT_SHA_INVALID'
    }
  }
  if(-not(Test-Path -LiteralPath $runtimeRepo)){throw 'RUNTIME_SOURCE_MISSING'}
  $head=([string](& git -C $runtimeRepo rev-parse HEAD 2>$null)).Trim()
  if($LASTEXITCODE -ne 0 -or $head -ne $sha){throw 'RUNTIME_SOURCE_HEAD_MISMATCH'}
  $dirty=@(& git -C $runtimeRepo status --porcelain 2>$null)
  if($LASTEXITCODE -ne 0){throw 'RUNTIME_SOURCE_STATUS_FAILED'}
  if($dirty.Count){throw 'RUNTIME_SOURCE_DIRTY'}
  return $runtimeRepo
}
$repo=Resolve-TrustedRuntimeRepo
$app=(Resolve-Path -LiteralPath (Join-Path $repo 'apps\tigeriq-coding-lane\coding-entry.mjs')).Path
if(-not(Test-Path -LiteralPath $app)){throw 'CODING_LANE_APP_MISSING'}
$mutex=New-Object Threading.Mutex($false,'Global\TigerIQCodingLaneSupervisorV1')
$owns=$false
try{$owns=$mutex.WaitOne(0)}catch{$owns=$false}
if(-not $owns){exit 73}
function Set-SecretEnv([string]$EnvName,[string]$SecretName,[string]$Entropy){
  $value=Get-TigerIQSecret $SecretName $Entropy
  if(-not[string]::IsNullOrWhiteSpace($value)){[Environment]::SetEnvironmentVariable($EnvName,$value,'Process')}
}
# Owner-approved standing Free proof: no synthetic monthly expiry extension.
# Fail closed for missing scope/approval or unsafe paid/billing flags.
# Only NV11 Groq and NV12 Gemini are admitted by this standing gate.
function Test-TigerIQFreeProviderProof([object]$Proof,[string]$Provider) {
  if($null -eq $Proof -or $Provider -notin @('groq','gemini')){return $false}
  if(-not $Proof.PSObject.Properties['provider'] -or [string]$Proof.provider -cne $Provider){return $false}
  if([string]$Proof.plan -cne 'Free' -or [double]$Proof.priceUsd -ne 0 -or $Proof.ownerConfirmed -cne $true -or $Proof.paidFallbackAllowed -cne $false){return $false}
  if($Provider -eq 'gemini' -and $Proof.billingLinked -cne $false){return $false}
  $now=[DateTime]::UtcNow
  $expires=[DateTime]::MinValue
  if($Proof.PSObject.Properties['expiresAtUtc']){try{$expires=[DateTime]::Parse([string]$Proof.expiresAtUtc).ToUniversalTime()}catch{return $false}}
  if($expires -gt $now){return $true}
  # Current screenshot and explicit Owner scope permit continued free-only use;
  # any paid-account setting change must revoke this standing authorization.
  if(-not $Proof.PSObject.Properties['standingZeroCostApproved'] -or $Proof.standingZeroCostApproved -cne $true){return $false}
  if(-not $Proof.PSObject.Properties['standingApprovalSource'] -or [string]$Proof.standingApprovalSource -cne 'owner_direct_2026-10-15'){return $false}
  if(-not $Proof.PSObject.Properties['verifiedAtUtc']){return $false}
  try{$verified=[DateTime]::Parse([string]$Proof.verifiedAtUtc).ToUniversalTime()}catch{return $false}
  if($verified -gt $now -or $verified -lt [DateTime]'2026-10-15T00:00:00Z'){return $false}
  if(-not $Proof.PSObject.Properties['source'] -or [string]$Proof.source -notlike 'owner_screenshot_2026-10-15_*'){return $false}
  return $true
}
function Clear-ProviderEnvironment {
  foreach($name in @('GROQ_API_KEY','GEMINI_API_KEY','OPENROUTER_API_KEY','MISTRAL_API_KEY','CLOUDFLARE_AUTH_TOKEN','CLOUDFLARE_ACCOUNT_ID','HF_TOKEN','COHERE_API_KEY','INCEPTION_API_KEY','NVIDIA_API_KEY','TIGERIQ_GROQ_FREE_TIER_VERIFIED','TIGERIQ_GEMINI_FREE_TIER_VERIFIED','TIGERIQ_COHERE_TRIAL_CONFIRMED','TIGERIQ_INCEPTION_FREE_TIER_VERIFIED','TIGERIQ_CLOUDFLARE_FREE_CONFIRMED','TIGERIQ_NVIDIA_FREE_DEV_CONFIRMED','TIGERIQ_INCEPTION_MODEL','TIGERIQ_NVIDIA_MODEL','TIGERIQ_GEMINI_MODEL','TIGERIQ_GEMINI_MIN_INTERVAL_MS','TIGERIQ_GEMINI_BACKOFF_BASE_MS','TIGERIQ_GEMINI_MAX_ATTEMPTS','TIGERIQ_CODING_MAX_PARALLEL')){[Environment]::SetEnvironmentVariable($name,$null,'Process')}
}
function Load-Environment {
  Clear-ProviderEnvironment
  $env:DATABASE_URL=(Get-Content -Raw 'D:\TigerIQ\Secrets\workforce-controller-v1.database-url').Trim()
  $pgLine=(Get-Content 'D:\TigerIQ\Secrets\workforce-controller-v1.pgpass'|Where-Object{$_ -and -not $_.StartsWith('#')}|Select-Object -First 1)
  if(-not $pgLine){throw 'PGPASSWORD_MISSING'}
  $env:PGPASSWORD=([string]$pgLine).Split(':',5)[4]
  $env:TIGERIQ_GITHUB_TOKEN=(Get-Content -Raw 'D:\TigerIQ\Secrets\github-command-center.token').Trim()
  $env:TIGERIQ_CODING_HOST='127.0.0.1'
  $env:TIGERIQ_CODING_PORT='8797'
  $env:TIGERIQ_CODING_AUTO_MERGE='true'
  $env:TIGERIQ_ALLOW_PAID_AI='false'
  $env:TIGERIQ_GEMINI_MODEL='gemini-3.5-flash-lite'
  $env:TIGERIQ_GEMINI_MIN_INTERVAL_MS='4500'
  $env:TIGERIQ_GEMINI_BACKOFF_BASE_MS='4500'
  $env:TIGERIQ_GEMINI_MAX_ATTEMPTS='4'
  $env:TIGERIQ_CODING_MAX_PARALLEL='6'
  # Owner P0 2026-10-13: manager tick may not hold existing ready workers.
  # Rollback: set this flag to 'false' in a guarded PR and let the existing runtime updater restart Coding Lane only.
  $env:TIGERIQ_CODING_MANAGER_DECOUPLED='true'
  # #280/B03: Core offers a bounded, read-only health endpoint.
  # If the fast Core route becomes unavailable, Coding Lane fails closed.
  # Rollback to legacy /api/status via a guarded PR setting this to false.
  $env:TIGERIQ_CODING_FAST_CORE_HEALTH='true'
  $groqProof=Get-Content -Raw 'D:\TigerIQ\Secrets\groq-free-tier-proof.json'|ConvertFrom-Json
  $geminiProof=Get-Content -Raw 'D:\TigerIQ\Secrets\gemini-free-tier-proof.json'|ConvertFrom-Json
  if(Test-TigerIQFreeProviderProof -Proof $groqProof -Provider 'groq'){Set-SecretEnv 'GROQ_API_KEY' 'groq-api-key' 'TigerIQ-Groq-PC01-v1';$env:TIGERIQ_GROQ_FREE_TIER_VERIFIED='true'}
  if(Test-TigerIQFreeProviderProof -Proof $geminiProof -Provider 'gemini'){Set-SecretEnv 'GEMINI_API_KEY' 'gemini-api-key' 'TigerIQ-Gemini-PC01-v1';$env:TIGERIQ_GEMINI_FREE_TIER_VERIFIED='true'}
  $co=Get-TigerIQConfig 'cohere-proof'
  if($co -and $co.PSObject.Properties['trialConfirmed'] -and $co.trialConfirmed){Set-SecretEnv 'COHERE_API_KEY' 'cohere-api-key' 'TigerIQ-Cohere-PC01-v1';$env:TIGERIQ_COHERE_TRIAL_CONFIRMED='true'}
  # #572 established the existing Cloudflare Workers AI allocation as Free with no paid fallback.
  Set-SecretEnv 'CLOUDFLARE_AUTH_TOKEN' 'cloudflare-auth-token' 'TigerIQ-Cloudflare-PC01-v1'
  $cf=Get-TigerIQConfig 'cloudflare-config'
  if($cf -and $cf.PSObject.Properties['accountId'] -and $env:CLOUDFLARE_AUTH_TOKEN){$env:CLOUDFLARE_ACCOUNT_ID=[string]$cf.accountId;$env:TIGERIQ_CLOUDFLARE_FREE_CONFIRMED='true'}
  $nv=Get-TigerIQConfig 'nvidia-proof'
  if($nv -and $nv.PSObject.Properties['freeConfirmed'] -and $nv.freeConfirmed -and $nv.PSObject.Properties['paidFallbackAllowed'] -and -not $nv.paidFallbackAllowed -and $nv.PSObject.Properties['ownerConfirmed'] -and $nv.ownerConfirmed){Set-SecretEnv 'NVIDIA_API_KEY' 'nvidia-api-key' 'TigerIQ-NVIDIA-PC01-v1';$env:TIGERIQ_NVIDIA_FREE_DEV_CONFIRMED='true';$env:TIGERIQ_NVIDIA_MODEL='nvidia/nemotron-3-super-120b-a12b'}
  $inc=Get-TigerIQConfig 'inception-proof'
  if($inc -and $inc.PSObject.Properties['plan'] -and [string]$inc.plan -eq 'Free' -and $inc.PSObject.Properties['freeConfirmed'] -and $inc.freeConfirmed -and $inc.PSObject.Properties['freeTokens'] -and [double]$inc.freeTokens -gt 0 -and $inc.PSObject.Properties['creditCardRequired'] -and -not $inc.creditCardRequired -and $inc.PSObject.Properties['paidFallbackAllowed'] -and -not $inc.paidFallbackAllowed){Set-SecretEnv 'INCEPTION_API_KEY' 'inception-api-key' 'TigerIQ-Inception-PC01-v1';$env:TIGERIQ_INCEPTION_FREE_TIER_VERIFIED='true';$env:TIGERIQ_INCEPTION_MODEL='mercury-2.5'}
}
$logDir='D:\TigerIQ\Logs\CodingLane24x7';New-Item -ItemType Directory -Path $logDir -Force|Out-Null
while($true){
  try{
    Load-Environment
    $out=Join-Path $logDir ('coding-'+(Get-Date -Format 'yyyyMMdd')+'.out.log')
    $err=Join-Path $logDir ('coding-'+(Get-Date -Format 'yyyyMMdd')+'.err.log')
    $p=Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @($app) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
    $p.WaitForExit()
  }catch{Add-Content -Path (Join-Path $logDir 'supervisor.log') -Value ((Get-Date -Format o)+' '+$_.Exception.Message) -Encoding UTF8}
  Start-Sleep -Seconds 10
}
