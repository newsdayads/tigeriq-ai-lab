# TigerIQ interactive Windows UI adapter. Runs only in the existing signed-in broker.
# No shell command input, coordinates, secondary MCP server, or privileged desktop bypass.
$script:TigerIQAgentDesktopExe = 'D:\TigerIQ\Tools\agent-desktop\node_modules\.bin\agent-desktop.cmd'
$script:TigerIQAgentDesktopBlockedApps = @(
  'keepass.exe','bitwarden.exe','1password.exe','credentialuibroker.exe',
  'sechealthui.exe','consent.exe','logonui.exe'
)

function Invoke-TigerIQAgentDesktopCli([string[]] $Arguments, [string] $StdinText = $null) {
  if (-not (Test-Path -LiteralPath $script:TigerIQAgentDesktopExe -PathType Leaf)) {
    throw 'TIGERIQ_AGENT_DESKTOP_NOT_INSTALLED'
  }
  # Windows PowerShell 5.1 must decode native JSON as UTF-8 to preserve UI labels.
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  # PowerShell invokes a fixed executable with an array of arguments, never through cmd /c.
  if ($PSBoundParameters.ContainsKey('StdinText')) {
    # PowerShell 5.1's native pipeline can replace Unicode with '?'.
    # Deliver the exact UTF-8 bytes to the pinned native executable instead.
    if ($Arguments.Count -ne 3 -or $Arguments[0] -ne 'set-value' -or
        $Arguments[1] -notmatch '^@s[a-zA-Z0-9]+:e[0-9]+$' -or $Arguments[2] -ne '--stdin') {
      throw 'TIGERIQ_AGENT_DESKTOP_STDIN_ARGUMENTS_INVALID'
    }
    $native = 'D:\TigerIQ\Tools\agent-desktop\node_modules\agent-desktop\bin\agent-desktop-win32-x64.exe'
    if (-not (Test-Path -LiteralPath $native -PathType Leaf)) {
      throw 'TIGERIQ_AGENT_DESKTOP_NATIVE_MISSING'
    }
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $native
    $info.Arguments = "set-value $($Arguments[1]) --stdin"
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $info
    try {
      if (-not $proc.Start()) { throw 'TIGERIQ_AGENT_DESKTOP_START_FAILED' }
      $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
      $stderrTask = $proc.StandardError.ReadToEndAsync()
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($StdinText)
      $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
      $proc.StandardInput.Close()
      if (-not $proc.WaitForExit(15000)) {
        try { $proc.Kill() } catch {}
        throw 'TIGERIQ_AGENT_DESKTOP_PROCESS_TIMEOUT'
      }
      $responseText = ($stdoutTask.GetAwaiter().GetResult()).Trim()
      [void]$stderrTask.GetAwaiter().GetResult()
    } finally {
      $proc.Dispose()
    }
  } else {
    $responseText = (& $script:TigerIQAgentDesktopExe @Arguments 2>$null | Out-String).Trim()
  }
  if (-not $responseText) { throw 'TIGERIQ_AGENT_DESKTOP_EMPTY_RESPONSE' }
  try { $response = $responseText | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'TIGERIQ_AGENT_DESKTOP_INVALID_JSON' }
  if ($response.ok -ne $true) {
    $code = [string]$response.error.code
    if (-not $code -or $code -notmatch '^[A-Z0-9_]{2,80}$') { $code = 'ACTION_FAILED' }
    throw "TIGERIQ_AGENT_DESKTOP_$code"
  }
  return $response.data
}

function Test-TigerIQAgentDesktopAllowedWindow($Window) {
  $app = [string]$Window.app_name
  $title = [string]$Window.title
  if (-not $Window.accessible -or -not $Window.visible) { return $false }
  if ($script:TigerIQAgentDesktopBlockedApps -contains $app.ToLowerInvariant()) { return $false }
  if ($title -match '(?i)credential.manager|windows.security|bitwarden|keepass|1password|password.manager|uac|security.prompt') { return $false }
  if ($title -match '(?i)^administrator[: ]' -or $title -match '(?i)^select administrator[: ]') { return $false }
  return $true
}

function Get-TigerIQAgentDesktopWindows {
  $raw = @(Invoke-TigerIQAgentDesktopCli -Arguments @('list-windows'))
  return @($raw | Where-Object { $_ -and (Test-TigerIQAgentDesktopAllowedWindow $_) })
}

function Get-TigerIQAgentDesktopWindow($Request) {
  if (-not ($Request.processName -or $Request.windowName -or $Request.processId -or $Request.pid)) {
    throw 'TIGERIQ_AGENT_DESKTOP_TARGET_REQUIRED'
  }
  $found = @(Get-TigerIQAgentDesktopWindows | Where-Object {
    $w = $_
    $matches = $true
    if ($Request.processName) {
      $expected = ([string]$Request.processName).ToLowerInvariant().TrimEnd('.')
      $name = ([string]$w.app_name).ToLowerInvariant()
      if ($expected -notmatch '\.exe$') { $expected += '.exe' }
      if ($name -ne $expected) { $matches = $false }
    }
    $targetPid = if ($Request.processId) { [int]$Request.processId } elseif ($Request.pid) { [int]$Request.pid } else { 0 }
    if ($targetPid -and [int]$w.pid -ne $targetPid) { $matches = $false }
    if ($Request.windowName) {
      $t = [string]$Request.windowName
      $title = [string]$w.title
      if ($Request.match -eq 'exact') {
        if ($title -ine $t) { $matches = $false }
      } elseif ($title.IndexOf($t, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        $matches = $false
      }
    }
    $matches
  })
  if ($found.Count -eq 0) { throw 'TIGERIQ_AGENT_DESKTOP_WINDOW_NOT_FOUND' }
  if ($found.Count -ne 1) { throw 'TIGERIQ_AGENT_DESKTOP_WINDOW_AMBIGUOUS' }
  return $found[0]
}

function Get-TigerIQAgentDesktopNodes($Node) {
  if ($null -eq $Node) { return }
  if ($Node.ref_id) {
    $autoId = if ($Node.native_id.kind -eq 'automation_id') { [string]$Node.native_id.value } else { '' }
    [pscustomobject]@{
      Name=[string]$Node.name
      AutomationId=$autoId
      ControlType=[string]$Node.role
      Ref=[string]$Node.ref_id
      AvailableActions=@($Node.available_actions)
    }
  }
  foreach ($child in @($Node.children)) {
    if ($child) { Get-TigerIQAgentDesktopNodes $child }
  }
}

function Get-TigerIQAgentDesktopSnapshot($Window) {
  $snapshot = Invoke-TigerIQAgentDesktopCli -Arguments @('snapshot','--window-id',[string]$Window.id,'-i','--compact')
  if (-not $snapshot.complete -or -not $snapshot.tree) { throw 'TIGERIQ_AGENT_DESKTOP_SNAPSHOT_INCOMPLETE' }
  return $snapshot
}

function Find-TigerIQAgentDesktopElement($Request, $Window) {
  if ($Request.className) { throw 'TIGERIQ_AGENT_DESKTOP_CLASS_SELECTOR_UNSUPPORTED' }
  $snap = Get-TigerIQAgentDesktopSnapshot $Window
  $nodes = @(Get-TigerIQAgentDesktopNodes $snap.tree)
  $matched = @($nodes | Where-Object {
    $node = $_
    $ok = $true
    if ($Request.name) {
      $a = [string]$node.Name
      $b = [string]$Request.name
      if ($Request.match -eq 'exact') {
        if ($a -ine $b) { $ok = $false }
      } elseif ($a.IndexOf($b, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        $ok = $false
      }
    }
    if ($Request.automationId -and [string]$node.AutomationId -ine [string]$Request.automationId) { $ok = $false }
    if ($Request.controlType -and [string]$node.ControlType -ine [string]$Request.controlType) { $ok = $false }
    $ok
  })
  if ($matched.Count -eq 0) { throw 'TIGERIQ_AGENT_DESKTOP_ELEMENT_NOT_FOUND' }
  if ($null -ne $Request.index) {
    $index = [int]$Request.index
    if ($index -ge $matched.Count) { throw 'TIGERIQ_AGENT_DESKTOP_INDEX_OUT_OF_RANGE' }
    return [pscustomobject]@{ Element=$matched[$index]; MatchCount=$matched.Count }
  }
  if ($matched.Count -ne 1) { throw 'TIGERIQ_AGENT_DESKTOP_ELEMENT_AMBIGUOUS' }
  return [pscustomobject]@{ Element=$matched[0]; MatchCount=1 }
}

function Invoke-AgentDesktopAction($Request) {
  $action = [string]$Request.action
  if ($action -eq 'pad_windows') {
    return @(Get-TigerIQAgentDesktopWindows | ForEach-Object {
      [pscustomobject]@{
        Name=[string]$_.title; Process=[string]$_.app_name
        ProcessId=[int]$_.pid; WindowId=[string]$_.id
      }
    })
  }
  if ($action -eq 'pad_launch') {
    $app = [string]$Request.processName
    if ($app -notin @('notepad.exe','calc.exe','mspaint.exe')) {
      throw 'TIGERIQ_AGENT_DESKTOP_LAUNCH_NOT_ALLOWED'
    }
    return Invoke-TigerIQAgentDesktopCli -Arguments @('launch',$app)
  }
  $window = Get-TigerIQAgentDesktopWindow $Request
  if ($action -eq 'pad_tree') {
    $nodes = @(Get-TigerIQAgentDesktopNodes (Get-TigerIQAgentDesktopSnapshot $window).tree)
    $limit = if ($Request.maxResults) { [int]$Request.maxResults } else { 200 }
    return @($nodes | Select-Object -First $limit)
  }
  if ($action -eq 'pad_keys') {
    $map = @{
      'ENTER'='return'; 'ESC'='escape'; 'TAB'='tab'; 'F5'='f5'
      'CTRL+A'='ctrl+a'; 'CTRL+F'='ctrl+f'; 'CTRL+N'='ctrl+n'; 'CTRL+S'='ctrl+s'
    }
    $combo = $map[[string]$Request.key]
    if (-not $combo) { throw 'TIGERIQ_AGENT_DESKTOP_KEY_NOT_ALLOWED' }
    $response = Invoke-TigerIQAgentDesktopCli -Arguments @('press','--window-id',[string]$window.id,$combo)
    return [pscustomobject]@{ Key=[string]$Request.key; Method='AgentDesktopPress'; Verified=($null -ne $response) }
  }
  if ($action -notin @('pad_click','pad_invoke','pad_set_value')) { throw 'TIGERIQ_AGENT_DESKTOP_ACTION_NOT_ALLOWED' }
  $selected = Find-TigerIQAgentDesktopElement $Request $window
  $ref = [string]$selected.Element.Ref
  if ($action -eq 'pad_set_value') {
    # --stdin prevents the value from appearing in child-process command arguments.
    # The existing broker caps input at 500 chars and sanitizes control bytes.
    $value = [string]$Request.value
    $result = Invoke-TigerIQAgentDesktopCli -Arguments @('set-value',$ref,'--stdin') -StdinText $value
    return [pscustomobject]@{ Method='AgentDesktopSetValue'; MatchCount=$selected.MatchCount; Ref=$ref; Verified=($null -ne $result) }
  }
  $result = Invoke-TigerIQAgentDesktopCli -Arguments @('click',$ref)
  return [pscustomobject]@{ Method='AgentDesktopClick'; MatchCount=$selected.MatchCount; Ref=$ref; Delivered=($null -ne $result) }
}
