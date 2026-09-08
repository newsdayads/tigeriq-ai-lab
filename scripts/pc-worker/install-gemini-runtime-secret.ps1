param(
  [int]$ProofDays = 30
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Security
if ([Environment]::MachineName -ne 'PC01') { throw 'GEMINI_SECRET_WRONG_HOST' }
if ($ProofDays -lt 1 -or $ProofDays -gt 90) { throw 'GEMINI_SECRET_PROOF_DAYS_OUT_OF_RANGE' }
$secretDir = 'D:\TigerIQ\Secrets'
$secretPath = Join-Path $secretDir 'gemini-api-key.dpapi'
$proofPath = Join-Path $secretDir 'gemini-free-tier-proof.json'
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
  throw 'GEMINI_SECRET_ADMIN_REQUIRED'
}
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
Write-Host 'TigerIQ Gemini persistent credential install'
Write-Host 'Chi tiep tuc neu project Gemini API dang Free Tier va KHONG lien ket billing/PAYG.'
$confirm = Read-Host 'Nhap FREE de xac nhan'
if ($confirm.Trim().ToUpperInvariant() -ne 'FREE') { throw 'GEMINI_FREE_TIER_NOT_CONFIRMED' }
$secure = Read-Host 'Paste GEMINI_API_KEY (se bi an)' -AsSecureString$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = $null
$plainBytes = $null
$protected = $null
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($plain) -or -not $plain.StartsWith('AIza') -or $plain.Length -lt 30) {
    throw 'GEMINI_SECRET_INVALID_KEY_SHAPE'
  }
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($plain)
  $entropy = [Text.Encoding]::UTF8.GetBytes('TigerIQ-Gemini-PC01-v1')
  $protected = [Security.Cryptography.ProtectedData]::Protect(
    $plainBytes,$entropy,[Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  [Convert]::ToBase64String($protected) | Set-Content -LiteralPath $secretPath -NoNewline -Encoding ascii
  Protect-LocalFile $secretPath
  $now = [DateTime]::UtcNow
  $proof = [ordered]@{
    provider='gemini'; plan='Free'; priceUsd=0; ownerConfirmed=$true
    billingLinked=$false; paidFallbackAllowed=$false; model='gemini-2.5-flash'
    verifiedAtUtc=$now.ToString('o'); expiresAtUtc=$now.AddDays($ProofDays).ToString('o')
    source='owner_free_tier_confirmation_plus_official_pricing'
  }
  $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding UTF8
  Protect-LocalFile $proofPath
  Write-Host 'GEMINI_PERSISTENT_SECRET_INSTALLED'
  Write-Host ('FREE_TIER_PROOF_EXPIRES_UTC=' + $proof.expiresAtUtc)
} finally {
  if ($null -ne $plainBytes) { [Array]::Clear($plainBytes,0,$plainBytes.Length) }
  if ($null -ne $protected) { [Array]::Clear($protected,0,$protected.Length) }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $plain = $null
  $secure = $null
}
