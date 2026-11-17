# GH-5135: deterministic, fail-closed virtual-secondary-display image smoke.
# PowerShell 5.1, Android 12/S10. NEVER a physical Samsung DeX acceptance.
[CmdletBinding()]
param(
    [ValidateSet("ImageOnly", "VirtualDevice")]
    [string]$Mode = "ImageOnly",
    [string]$ImagePath,
    [int]$ExpectedWidth = 0,
    [int]$ExpectedHeight = 0,
    [int]$MinDistinctColors = 96,
    [double]$MinLuminanceStdDev = 12,
    [string]$AdbPath = 'D:\TigerIQ\Tools\platform-tools\adb.exe',
    [string]$Serial = 'R3CM400AKRX',
    [string]$QaPackage = 'ai.tigeriq.ultracarhcm.v2.vqa',
    [string]$Profile = '1920x1080/320',
    [string]$EvidenceDir = 'D:\TigerIQ\Evidence'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Measure-ScreenImage {
    param([string]$File, [int]$Width, [int]$Height)
    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::FromFile($File)
    try {
        $colors = @{}
        $sum = 0.0
        $sumSquares = 0.0
        $count = 0
        for ($y = 0; $y -lt $bitmap.Height; $y += 29) {
            for ($x = 0; $x -lt $bitmap.Width; $x += 29) {
                $pixel = $bitmap.GetPixel($x, $y)
                $colors[$pixel.ToArgb()] = $true
                $luminance = 0.299 * $pixel.R + 0.587 * $pixel.G + 0.114 * $pixel.B
                $sum += $luminance
                $sumSquares += $luminance * $luminance
                $count++
            }
        }
        $variance = [Math]::Max(0, $sumSquares / $count - [Math]::Pow($sum / $count, 2))
        $stdDev = [Math]::Sqrt($variance)
        $distinctColors = $colors.Count
        $sizeCorrect = ($Width -eq 0 -or $bitmap.Width -eq $Width) -and
            ($Height -eq 0 -or $bitmap.Height -eq $Height)
        $visualPass = $sizeCorrect -and
            $distinctColors -ge $MinDistinctColors -and
            $stdDev -ge $MinLuminanceStdDev
        [pscustomobject]@{
            visualPass = [bool]$visualPass
            width = $bitmap.Width
            height = $bitmap.Height
            expectedWidth = $Width
            expectedHeight = $Height
            sizeCorrect = [bool]$sizeCorrect
            distinctColors = $distinctColors
            stdDev = [Math]::Round($stdDev, 2)
            minColors = $MinDistinctColors
            minStdDev = $MinLuminanceStdDev
            sha256 = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash
            meaning = 'Non-flat screen only; NOT F01 parity or physical Samsung DeX'
        }
    } finally { $bitmap.Dispose() }
}

function Invoke-QaAdb {
    param([string[]]$Arguments)
    $lines = @(& $AdbPath -s $Serial @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw ("ADB_FAILED: " + ($Arguments -join ' ') + " => " + ($lines -join ' | '))
    }
    return @($lines | ForEach-Object { $_.ToString() })
}

if ($MinDistinctColors -lt 2 -or $MinLuminanceStdDev -le 0) {
    throw 'INVALID_VISUAL_THRESHOLD'
}
if ($Mode -eq 'ImageOnly') {
    if ([string]::IsNullOrWhiteSpace($ImagePath) -or -not (Test-Path -LiteralPath $ImagePath)) {
        throw 'IMAGE_ONLY_REQUIRES_REAL_PNG'
    }
    $metric = Measure-ScreenImage -File $ImagePath -Width $ExpectedWidth -Height $ExpectedHeight
    [pscustomobject]@{ mode = 'ImageOnly'; result = $metric } | ConvertTo-Json -Compress -Depth 4
    if (-not $metric.visualPass) { exit 2 }
    exit 0
}

# VirtualDevice only accepts isolated V2 QA; never touch V1 or production V2.
if ($QaPackage -cne 'ai.tigeriq.ultracarhcm.v2.vqa') {
    throw 'VirtualDevice only accepts isolated V2 QA'
}
if (@('1280x720/160', '1600x900/240', '1920x1080/320') -cnotcontains $Profile) {
    throw 'UNAPPROVED_VIRTUAL_SCREEN_PROFILE'
}
if (-not (Test-Path -LiteralPath $AdbPath) -or
    -not (Test-Path -LiteralPath $EvidenceDir)) {
    throw 'ADB_OR_EVIDENCE_DIRECTORY_MISSING'
}
$parts = $Profile -split '[/x]'
$targetWidth = [int]$parts[0]
$targetHeight = [int]$parts[1]
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')
$name = 'gh5135-visual-gate-' + $stamp + '-' + $targetWidth
$screenshot = Join-Path $EvidenceDir ($name + '.png')
$reportFile = Join-Path $EvidenceDir ($name + '.json')
if ((Test-Path -LiteralPath $screenshot) -or (Test-Path -LiteralPath $reportFile)) {
    throw 'EVIDENCE_EXISTS_REFUSE_OVERWRITE'
}

$originalSetting = ''
$restored = $false
$settingChanged = $false
$deviceDisplayId = $null
$metric = $null
$taskVerified = $false
$failure = $null
$startOutput = @()
$stopOutput = @()

try {
    # settings get global overlay_display_devices: deny changing any user setting.
    $originalSetting = (Invoke-QaAdb @('shell', 'settings', 'get', 'global', 'overlay_display_devices') -join '').Trim()
    if ($originalSetting -ne "null") {
        throw 'EXISTING_USER_OVERLAY_DISPLAY_SETTING_PRESENT'
    }
    $deviceList = Invoke-QaAdb @('get-state')
    if (($deviceList -join '').Trim() -ne 'device') { throw 'QA_DEVICE_NOT_CONNECTED' }
    $existing = Invoke-QaAdb @('shell', 'pm', 'path', $QaPackage)
    if (($existing -join ' ') -notmatch [regex]::Escape($QaPackage)) {
        throw 'ISOLATED_QA_APP_NOT_INSTALLED'
    }

    # Temporary virtual display; finally always restores user configuration.
    Invoke-QaAdb @('shell', 'settings', 'put', 'global', 'overlay_display_devices', $Profile) | Out-Null
    $settingChanged = $true
    Start-Sleep -Milliseconds 1800
    $displayDump = Invoke-QaAdb @('shell', 'dumpsys', 'display')
    $displayIds = @([regex]::Matches(($displayDump -join "`n"), 'mDisplayId=(\d+)') |
        ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    $secondary = @($displayIds | Where-Object { $_ -ne '0' })
    if ($secondary.Count -ne 1) {
        throw 'EXACTLY_ONE_SECONDARY_DISPLAY_REQUIRED'
    }
    $deviceDisplayId = $secondary[0]

    # am force-stop ONLY isolated QA package; am start -W --display NEW+MULTIPLE_TASK.
    $stopOutput = Invoke-QaAdb @('shell', 'am', 'force-stop', $QaPackage)
    $component = $QaPackage + '/ai.tigeriq.ultracarhcm.v2.HomeActivity'
    $startOutput = Invoke-QaAdb @('shell', 'am', 'start', '-W',
        '--display', $deviceDisplayId, '-f', '0x18000000', '-n', $component)
    Start-Sleep -Milliseconds 900
    $activities = Invoke-QaAdb @('shell', 'dumpsys', 'activity', 'activities')
    $activityText = $activities -join "`n"
    $pattern = '(?ms)^\s*Display #' + [regex]::Escape($deviceDisplayId) +
        ' \(activities from top to bottom\):(?<body>.*?)(?=^\s*Display #\d+ \(activities from top to bottom\):|\z)'
    $match = [regex]::Match($activityText, $pattern)
    # mResumedActivity on this exact target display is required, not just Status: ok.
    $taskVerified = $match.Success -and
        ($match.Groups['body'].Value -match ('mResumedActivity:[^\r\n]*' + [regex]::Escape($QaPackage)))
    if (-not $taskVerified) { throw 'QA_ACTIVITY_NOT_RESUMED_ON_TARGET_DISPLAY' }

    # screencap -p -d: capture actual secondary framebuffer, not primary.
    $remote = '/sdcard/' + $name + '.png'
    Invoke-QaAdb @('shell', 'screencap', '-p', '-d', $deviceDisplayId, $remote) | Out-Null
    Invoke-QaAdb @('pull', $remote, $screenshot) | Out-Null
    if (-not (Test-Path -LiteralPath $screenshot)) { throw 'SCREENSHOT_NOT_PULLED' }
    $metric = Measure-ScreenImage -File $screenshot -Width $targetWidth -Height $targetHeight
    if (-not $metric.visualPass) { throw 'FLAT_OR_WRONG_SIZE_SECONDARY_SCREEN' }
} catch {
    $failure = $_.Exception.Message
} finally {
    if ($settingChanged) {
        try {
            # settings delete global overlay_display_devices is mandatory.
            Invoke-QaAdb @('shell', 'settings', 'delete', 'global', 'overlay_display_devices') | Out-Null
            $newSetting = (Invoke-QaAdb @('shell', 'settings', 'get', 'global', 'overlay_display_devices') -join '').Trim()
            $restored = $newSetting -eq 'null'
        } catch {
            $failure = 'DISPLAY_RESTORE_ERROR: ' + $_.Exception.Message + '; original=' + $failure
            $restored = $false
        }
    } else {
        $restored = $true
    }
}
$pass = $null -ne $metric -and $metric.visualPass -and $taskVerified -and
    $restored -and $null -eq $failure
$report = [ordered]@{
    mode = 'VirtualDevice'
    status = if ($pass) { 'NONFLAT_SECONDARY_QA_PASS' } else { 'BLOCKED_BY_QA_GUARD' }
    verified = [bool]$pass
    package = $QaPackage
    profile = $Profile
    displayId = $deviceDisplayId
    taskVerified = [bool]$taskVerified
    image = $screenshot
    measurement = $metric
    originalSetting = $originalSetting
    restored = [bool]$restored
    failure = $failure
    notRealSamsungDex = $true
    noV1GoldenComparison = $true
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportFile -Encoding UTF8
$report | ConvertTo-Json -Compress -Depth 6
if (-not $restored) { Write-Error 'ALERT_DISPLAY_RESTORE_NOT_VERIFIED' }
if (-not $pass) { exit 2 }
exit 0
