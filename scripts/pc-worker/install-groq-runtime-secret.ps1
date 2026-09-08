param(
  [int]$ProofDays = 30
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::MachineName -ne 'PC01') { throw 'GROQ_SECRET_WRONG_HOST' }
if ($ProofDays -lt 1 -or $ProofDays -gt 90) { throw 'GROQ_SECRET_PROOF_DAYS_OUT_OF_RANGE' }
$secretDir = 'D:\TigerIQ\Secrets'
$secretPath = Join-Path $secretDir 'groq-api-key.dpapi'
$proofPath = Join-Path $secretDir 'groq-free-tier-proof.json'
function Protect-LocalFile([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -Path $Path -AclObject $acl
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'GROQ_SECRET_ADMIN_REQUIRED'
}
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
Write-Host 'TigerIQ Groq persistent credential install'
Write-Host 'Chi tiep tuc neu Groq dang Free $0 va khong co paid fallback.'
$secure = Read-Host 'Paste GROQ_API_KEY (se bi an)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = $null
$plainBytes = $null
$protected = $null
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain) -or -not $plain.StartsWith('gsk_') -or $plain.Length -lt 24) {
    throw 'GROQ_SECRET_INVALID_KEY_SHAPE'
  }
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($plain)
  $entropy = [Text.Encoding]::UTF8.GetBytes('TigerIQ-Groq-PC01-v1')
  $protected = [Security.Cryptography.ProtectedData]::Protect(
    $plainBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  [Convert]::ToBase64String($protected) | Set-Content -LiteralPath $secretPath -NoNewline -Encoding ascii
  Protect-LocalFile $secretPath
  $now = [DateTime]::UtcNow
  $proof = [ordered]@{
    provider='groq'; plan='Free'; priceUsd=0; ownerConfirmed=$true
    verifiedAtUtc=$now.ToString('o'); expiresAtUtc=$now.AddDays($ProofDays).ToString('o')
    source='owner_visual_confirmation'; paidFallbackAllowed=$false
  }
  $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding UTF8
  Protect-LocalFile $proofPath
  Write-Host 'GROQ_PERSISTENT_SECRET_INSTALLED'
  Write-Host ('FREE_TIER_PROOF_EXPIRES_UTC=' + $proof.expiresAtUtc)
} finally {  if ($null -ne $plainBytes) { [Array]::Clear($plainBytes,0,$plainBytes.Length) }
  if ($null -ne $protected) { [Array]::Clear($protected,0,$protected.Length) }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $plain = $null
  $secure = $null
}