$ErrorActionPreference = 'Stop'
# WO 4783: fixed, observation-only endpoint. No CLI, shell, credential or DB action.
$Root = 'C:\ProgramData\TigerIQNV07'
$PipeName = 'TigerIQ.NV07.4783'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$session = [Diagnostics.Process]::GetCurrentProcess().SessionId
if ([Environment]::MachineName -ne 'PC01' -or $identity.Name -ne 'PC01\wdragons12x' -or $session -le 0) {
  throw 'NV07_OWNER_INTERACTIVE_SESSION_REQUIRED'
}
$codeHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
$userSid = $identity.User
$security = New-Object IO.Pipes.PipeSecurity
$security.SetAccessRuleProtection($true, $false)
$security.AddAccessRule((New-Object IO.Pipes.PipeAccessRule(
  (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),
  [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)))
$security.AddAccessRule((New-Object IO.Pipes.PipeAccessRule(
  $userSid, [IO.Pipes.PipeAccessRights]::ReadWrite,
  [Security.AccessControl.AccessControlType]::Allow)))
$created = $false
$mutex = New-Object Threading.Mutex($true, 'Local\TigerIQNv07ProtectedSession4783', [ref]$created)
if (-not $created) { exit 0 }
try {
  while ($true) {
    $pipe = $null; $reader = $null; $writer = $null
    try {
      $pipe = New-Object IO.Pipes.NamedPipeServerStream(
        $PipeName, [IO.Pipes.PipeDirection]::InOut, 1,
        [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous,
        4096, 4096, $security)
      $connection = $pipe.BeginWaitForConnection($null, $null)
      while (-not $connection.AsyncWaitHandle.WaitOne(1000)) {}
      $pipe.EndWaitForConnection($connection)
      $connection.AsyncWaitHandle.Close()
      $reader = New-Object IO.StreamReader($pipe, (New-Object Text.UTF8Encoding($false)), $false, 4096, $true)
      $writer = New-Object IO.StreamWriter($pipe, (New-Object Text.UTF8Encoding($false)), 4096, $true)
      $writer.AutoFlush = $true
      $read = $reader.ReadLineAsync()
      if (-not $read.Wait(15000)) { continue }
      $line = [string]$read.Result
      if ($line.Length -gt 4096) { continue }
      $request = $line | ConvertFrom-Json
      $valid = $request.schema -eq 'NV07_PROTECTED_SESSION_PROBE_V1' -and
        $request.action -eq 'ATTEST_SESSION_ONLY' -and
        [string]$request.nonce -match '^[a-f0-9-]{36}$'
      if (-not $valid) {
        $writer.WriteLine('{"ok":false,"code":"NV07_ACTION_DENIED"}')
        continue
      }
      # A peer must independently verify OS server PID/token, task origin,
      # protected path and pinned bytes. This JSON never grants authority.
      $reply = @{
        schema='NV07_PROTECTED_SESSION_PROBE_V1'
        ok=$true
        action='ATTEST_SESSION_ONLY'
        nonce=[string]$request.nonce
        host=[Environment]::MachineName
        windowsUser='wdragons12x'
        userSid=$identity.User.Value
        sessionId=$session
        pid=$PID
        codeHash=$codeHash
        at=[DateTime]::UtcNow.ToString('o')
        authority='OBSERVATION_ONLY'
        attestationVerified=$false
        coreLeaseVerified=$false
        nv07Active=$false
      }
      $writer.WriteLine(($reply | ConvertTo-Json -Depth 4 -Compress))
    } catch {
      # Do not persist raw exception text or retry a CLI action: none exists here.
    } finally {
      if ($writer) { $writer.Dispose() }
      if ($reader) { $reader.Dispose() }
      if ($pipe) { $pipe.Dispose() }
    }
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
