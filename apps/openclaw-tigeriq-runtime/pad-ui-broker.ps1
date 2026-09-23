$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TigerIQPadNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
"@

$RootPath = 'D:\TigerIQ\State\pad-ui-broker'
$Requests = Join-Path $RootPath 'requests'
$Responses = Join-Path $RootPath 'responses'
$Heartbeat = Join-Path $RootPath 'heartbeat.json'
New-Item -ItemType Directory -Force -Path $Requests,$Responses | Out-Null

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\TigerIQPadUiBrokerV1', [ref]$created)
if (-not $created) { exit 0 }

function Write-JsonAtomic([string]$Path, $Value) {
  $tmp = "$Path.tmp-$PID"
  $Value | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Get-ProcessName([int]$PidValue) {
  try { return (Get-Process -Id $PidValue -ErrorAction Stop).ProcessName } catch { return '' }
}

function Test-PadWindow($Window) {
  try {
    $name = [string]$Window.Current.Name
    $proc = Get-ProcessName $Window.Current.ProcessId
    if ($proc -like 'PAD.*' -or $proc -eq 'Microsoft.Flow.RPA.Desktop') { return $true }
    return ($proc -eq 'msedgewebview2' -and $name -match 'Power Automate')
  } catch { return $false }
}

function Get-PadWindows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $out = @()
  foreach ($w in $all) {
    if (-not (Test-PadWindow $w)) { continue }
    try {
      $r = $w.Current.BoundingRectangle
      $out += [pscustomobject]@{
        Name=[string]$w.Current.Name
        AutomationId=[string]$w.Current.AutomationId
        ProcessId=[int]$w.Current.ProcessId
        Process=(Get-ProcessName $w.Current.ProcessId)
        X=(Safe-UiNumber $r.X); Y=(Safe-UiNumber $r.Y); Width=(Safe-UiNumber $r.Width); Height=(Safe-UiNumber $r.Height)
      }
    } catch {}
  }
  return @($out)
}

function Find-PadWindow($Request) {
  $windows = @(Get-PadWindows)
  if ($Request.windowName) {
    $windows = @($windows | Where-Object { $_.Name -eq [string]$Request.windowName })
  }
  if ($windows.Count -eq 0) { throw 'TIGERIQ_PAD_UI_WINDOW_NOT_FOUND' }
  if ($windows.Count -gt 1 -and -not $Request.windowName) {
    $named = @($windows | Where-Object { $_.Name -match 'Power Automate' })
    if ($named.Count -eq 1) { $windows = $named }
  }
  if ($windows.Count -ne 1) { throw 'TIGERIQ_PAD_UI_WINDOW_AMBIGUOUS' }
  return [System.Windows.Automation.AutomationElement]::FromHandle((Get-Process -Id $windows[0].ProcessId).MainWindowHandle)
}

function Get-TopWindowElement($Request) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $matches = @()
  foreach ($w in $all) {
    if (-not (Test-PadWindow $w)) { continue }
    if ($Request.windowName -and [string]$w.Current.Name -ne [string]$Request.windowName) { continue }
    $matches += $w
  }
  if ($matches.Count -eq 0) { throw 'TIGERIQ_PAD_UI_WINDOW_NOT_FOUND' }
  if ($matches.Count -gt 1 -and -not $Request.windowName) {
    $named = @($matches | Where-Object { $_.Current.Name -match 'Power Automate' })
    if ($named.Count -eq 1) { $matches = $named }
  }
  if ($matches.Count -ne 1) { throw 'TIGERIQ_PAD_UI_WINDOW_AMBIGUOUS' }
  return $matches[0]
}

function Safe-UiNumber($Value) {
  try {
    $n=[double]$Value
    if ([double]::IsNaN($n) -or [double]::IsInfinity($n)) { return $null }
    return [math]::Round($n,0)
  } catch { return $null }
}

function Element-ToObject($e) {
  $r = $e.Current.BoundingRectangle
  $patterns = @()
  foreach ($p in @(
    [System.Windows.Automation.InvokePattern]::Pattern,
    [System.Windows.Automation.ValuePattern]::Pattern,
    [System.Windows.Automation.SelectionItemPattern]::Pattern
  )) {
    $obj = $null
    try { if ($e.TryGetCurrentPattern($p,[ref]$obj)) { $patterns += $p.ProgrammaticName } } catch {}
  }
  return [pscustomobject]@{
    Name=[string]$e.Current.Name
    AutomationId=[string]$e.Current.AutomationId
    ControlType=[string]$e.Current.ControlType.ProgrammaticName
    IsEnabled=[bool]$e.Current.IsEnabled
    IsOffscreen=[bool]$e.Current.IsOffscreen
    X=(Safe-UiNumber $r.X); Y=(Safe-UiNumber $r.Y); Width=(Safe-UiNumber $r.Width); Height=(Safe-UiNumber $r.Height)
    Patterns=$patterns
  }
}

function Find-PadElement($Request) {
  $window = Get-TopWindowElement $Request
  $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $matches = @()
  $mode = if ($Request.match) { [string]$Request.match } else { 'exact' }
  foreach ($e in $all) {
    try {
      $ok = $true
      if ($Request.name) {
        $n = [string]$e.Current.Name
        $ok = if ($mode -eq 'contains') { $n -like "*$($Request.name)*" } else { $n -eq [string]$Request.name }
      }
      if ($ok -and $Request.automationId) { $ok = [string]$e.Current.AutomationId -eq [string]$Request.automationId }
      if ($ok -and $Request.controlType) {
        $ct = [string]$e.Current.ControlType.ProgrammaticName
        $want = [string]$Request.controlType
        $ok = ($ct -eq $want -or $ct -eq "ControlType.$want")
      }
      if ($ok) { $matches += $e }
    } catch {}
  }
  if ($matches.Count -eq 0) { throw 'TIGERIQ_PAD_UI_ELEMENT_NOT_FOUND' }
  $index = if ($null -ne $Request.index) { [int]$Request.index } else { 0 }
  if ($matches.Count -gt 1 -and $null -eq $Request.index) { throw 'TIGERIQ_PAD_UI_ELEMENT_AMBIGUOUS' }
  if ($index -ge $matches.Count) { throw 'TIGERIQ_PAD_UI_INDEX_OUT_OF_RANGE' }
  return [pscustomobject]@{ Window=$window; Element=$matches[$index]; Count=$matches.Count }
}

function Invoke-PadElement($Request, [bool]$AllowClickFallback) {
  $found = Find-PadElement $Request
  $e = $found.Element
  $pattern = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
    $pattern.Invoke()
    return [pscustomobject]@{ Method='InvokePattern'; MatchCount=$found.Count; Element=(Element-ToObject $e) }
  }
  if (-not $AllowClickFallback) { throw 'TIGERIQ_PAD_UI_INVOKE_PATTERN_UNAVAILABLE' }
  $r = $e.Current.BoundingRectangle
  if ($r.Width -le 0 -or $r.Height -le 0) { throw 'TIGERIQ_PAD_UI_ELEMENT_NOT_CLICKABLE' }
  [TigerIQPadNative]::SetForegroundWindow([IntPtr]$found.Window.Current.NativeWindowHandle) | Out-Null
  $x=[int]($r.X + $r.Width/2); $y=[int]($r.Y + $r.Height/2)
  [TigerIQPadNative]::SetCursorPos($x,$y) | Out-Null
  [TigerIQPadNative]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
  [TigerIQPadNative]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
  return [pscustomobject]@{ Method='ElementCenterClick'; MatchCount=$found.Count; Element=(Element-ToObject $e) }
}

function Set-PadValue($Request) {
  $found = Find-PadElement $Request
  $p = $null
  if (-not $found.Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)) {
    throw 'TIGERIQ_PAD_UI_VALUE_PATTERN_UNAVAILABLE'
  }
  $p.SetValue([string]$Request.value)
  return [pscustomobject]@{ Method='ValuePattern'; MatchCount=$found.Count; Element=(Element-ToObject $found.Element) }
}

function Send-PadKey($Request) {
  $window = Get-TopWindowElement $Request
  [TigerIQPadNative]::SetForegroundWindow([IntPtr]$window.Current.NativeWindowHandle) | Out-Null
  if ($Request.name -or $Request.automationId) {
    $found = Find-PadElement $Request
    $found.Element.SetFocus()
  }
  $map = @{
    'ENTER'='{ENTER}'; 'ESC'='{ESC}'; 'TAB'='{TAB}'; 'CTRL+A'='^a'; 'CTRL+F'='^f'; 'CTRL+N'='^n'; 'F5'='{F5}'
  }
  $token = $map[[string]$Request.key]
  if (-not $token) { throw 'TIGERIQ_PAD_UI_KEY_NOT_ALLOWED' }
  [System.Windows.Forms.SendKeys]::SendWait($token)
  return [pscustomobject]@{ Key=[string]$Request.key }
}

function Invoke-Request($Request) {
  switch ([string]$Request.action) {
    'pad_launch' {
      Start-Process 'ms-powerautomate:' | Out-Null
      return [pscustomobject]@{ Launched=$true }
    }
    'pad_windows' { return @(Get-PadWindows) }
    'pad_tree' {
      $window = Get-TopWindowElement $Request
      $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
      $limit = if ($Request.maxResults) { [math]::Min(400,[int]$Request.maxResults) } else { 200 }
      $out = @()
      foreach ($e in $all) {
        if ($out.Count -ge $limit) { break }
        try {
          if ([string]$e.Current.Name -or [string]$e.Current.AutomationId) { $out += (Element-ToObject $e) }
        } catch {}
      }
      return [pscustomobject]@{ RawCount=[int]$all.Count; Items=@($out) }
    }
    'pad_invoke' { return Invoke-PadElement $Request $false }
    'pad_click' { return Invoke-PadElement $Request $true }
    'pad_set_value' { return Set-PadValue $Request }
    'pad_keys' { return Send-PadKey $Request }
    default { throw 'TIGERIQ_PAD_UI_ACTION_NOT_ALLOWED' }
  }
}

try {
  while ($true) {
    Write-JsonAtomic $Heartbeat ([pscustomobject]@{
      schema='TIGERIQ_PAD_UI_HEARTBEAT_V1'; version='1.0'; at=(Get-Date).ToUniversalTime().ToString('o')
      sessionId=(Get-Process -Id $PID).SessionId; user=[Environment]::UserName; pid=$PID
    })

    $items = @(Get-ChildItem -LiteralPath $Requests -Filter 'request-*.json' -File -ErrorAction SilentlyContinue | Sort-Object CreationTimeUtc | Select-Object -First 5)
    foreach ($item in $items) {
      $req = $null
      try {
        $req = Get-Content -LiteralPath $item.FullName -Raw | ConvertFrom-Json
        if ([string]$req.schema -ne 'TIGERIQ_PAD_UI_REQUEST_V1' -or [string]$req.id -notmatch '^[0-9a-f-]{36}$') { throw 'TIGERIQ_PAD_UI_REQUEST_INVALID' }
        $data = Invoke-Request $req
        $resp = [pscustomobject]@{ schema='TIGERIQ_PAD_UI_RESPONSE_V1'; id=[string]$req.id; ok=$true; data=$data; completedAt=(Get-Date).ToUniversalTime().ToString('o') }
      } catch {
        $resp = [pscustomobject]@{ schema='TIGERIQ_PAD_UI_RESPONSE_V1'; id=[string]$req.id; ok=$false; error=[string]$_.Exception.Message; completedAt=(Get-Date).ToUniversalTime().ToString('o') }
      }
      if ($req -and $req.id) {
        Write-JsonAtomic (Join-Path $Responses "response-$($req.id).json") $resp
      }
      Remove-Item -LiteralPath $item.FullName -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 200
  }
} finally {
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
