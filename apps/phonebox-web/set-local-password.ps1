# Reset only the PhoneBox Web app password; NEVER changes the Windows Administrator account.
# Run interactively as the user who owns the PhoneBox Web scheduled task.
[CmdletBinding()]
param(
    [string]$AuthFile = (Join-Path $env:USERPROFILE '.tigeriq\secrets\phonebox-web-auth.json')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $AuthFile -PathType Leaf)) { throw 'PHONEBOX_AUTH_FILE_MISSING' }
$previous = Get-Content -LiteralPath $AuthFile -Raw | ConvertFrom-Json
if (-not $previous.salt -or -not $previous.hash -or -not $previous.sessionSecret) { throw 'PHONEBOX_AUTH_FILE_INVALID' }

$first = Read-Host 'New PhoneBox Web password (input hidden)' -AsSecureString
$second = Read-Host 'Confirm password (input hidden)' -AsSecureString
$firstPtr = [IntPtr]::Zero
$secondPtr = [IntPtr]::Zero
$firstPlain = $null
$secondPlain = $null
try {
    $firstPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
    $secondPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
    $firstPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPtr)
    $secondPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPtr)
    if ($firstPlain -cne $secondPlain) { throw 'PASSWORD_CONFIRMATION_MISMATCH' }
    if ($firstPlain.Length -lt 10) { throw 'PASSWORD_TOO_SHORT' }
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $salt = New-Object byte[] 24
        $session = New-Object byte[] 48
        $rng.GetBytes($salt)
        $rng.GetBytes($session)
        $derive = [Security.Cryptography.Rfc2898DeriveBytes]::new(
            $firstPlain, $salt, 310000, [Security.Cryptography.HashAlgorithmName]::SHA256
        )
        try { $hash = $derive.GetBytes(32) }
        finally { $derive.Dispose() }
        $hex = { param($bytes) ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant() }
        $next = [ordered]@{
            salt = (& $hex $salt)
            hash = (& $hex $hash)
            sessionSecret = (& $hex $session)
        }
    }
    finally { $rng.Dispose() }
}
finally {
    if ($firstPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPtr) }
    if ($secondPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPtr) }
    $firstPlain = $null
    $secondPlain = $null
}

$path = [IO.Path]::GetFullPath($AuthFile)
$backup = "$path.before-password-reset.bak"
$temp = "$path.$PID.new"
if (Test-Path -LiteralPath $backup) { throw 'EXISTING_RESET_BACKUP_ABORT' }
if (Test-Path -LiteralPath $temp) { throw 'EXISTING_TEMP_FILE_ABORT' }
$acl = Get-Acl -LiteralPath $path
try {
    [IO.File]::WriteAllText($temp, ($next | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
    Set-Acl -LiteralPath $temp -AclObject $acl
    [IO.File]::Replace($temp, $path, $backup)
    Set-Acl -LiteralPath $path -AclObject $acl
    Set-Acl -LiteralPath $backup -AclObject $acl
    Write-Output 'PHONEBOX_WEB_PASSWORD_UPDATED_NO_SECRET_PRINTED'
    Write-Output 'Restart the existing TigerIQ PhoneBox Web scheduled task to apply the new password.'
}
finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
