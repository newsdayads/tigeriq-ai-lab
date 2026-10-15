$ErrorActionPreference = 'Stop'
# WO 4783: fixed metadata-only endpoint. CLI requires a protected Core reservation and exact OS client PID; never a caller-supplied command.
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
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class Nv07ClientPid {
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeClientProcessId(IntPtr pipe,out uint pid);
 public static uint Read(IntPtr pipe){uint pid;if(!GetNamedPipeClientProcessId(pipe,out pid))throw new Win32Exception();return pid;}
}
'@
$used = New-Object 'Collections.Generic.HashSet[string]'
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
        $request.action -in @('ATTEST_SESSION_ONLY','READ_METADATA_ONCE') -and
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
        action=[string]$request.action
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
      if($request.action -eq 'READ_METADATA_ONCE'){
        $invocationId=[string]$request.invocationId
        if($invocationId -notmatch '^[a-f0-9-]{36}$' -or $used.Contains($invocationId)){throw 'NV07_ONCE_OR_ID_DENIED'}
        $requestFile=$Root+'\ipc\requests\invocation-'+$invocationId+'.json'
        if((Get-Item -LiteralPath $requestFile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'NV07_REQUEST_REPARSE'}
        $d=Get-Content -LiteralPath $requestFile -Raw|ConvertFrom-Json
        $peer=[int][Nv07ClientPid]::Read($pipe.SafePipeHandle.DangerousGetHandle())
        if($d.schema -ne 'NV07_PROTECTED_CORE_INVOCATION_V1' -or $d.invocationId -ne $invocationId -or
           $d.authorizedClientPid -ne $peer -or $d.brokerPid -ne $PID -or $d.workOrderId -ne 4783 -or
           $d.resourceScope -ne 'TIGERIQ_NV07_PC01_READ_ONLY_CANARY_4783' -or
           [DateTime]::Parse($d.expiresAt).ToUniversalTime() -le [DateTime]::UtcNow){throw 'NV07_CORE_PEER_BINDING_DENIED'}
        $manifest=Get-Content -LiteralPath ($Root+'\deployment.json') -Raw|ConvertFrom-Json
        $helper=$Root+'\code\nv07-protected-cli-helper.mjs'
        $node='C:\Program Files\nodejs\node.exe'
        if((Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.helperSha256 -or
           (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.nodeSha256){throw 'NV07_HELPER_BYTES_DENIED'}
        [void]$used.Add($invocationId)
        $info=New-Object Diagnostics.ProcessStartInfo
        $info.FileName=$node
        $info.Arguments='"'+$helper+'" "'+$invocationId+'"'
        $info.UseShellExecute=$false;$info.CreateNoWindow=$true
        $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
        $info.WorkingDirectory=$Root+'\NV07\proposal-sandbox'
        $child=New-Object Diagnostics.Process
        $child.StartInfo=$info
        try{
          if(-not $child.Start()){throw 'NV07_HELPER_NOT_STARTED'}
          $stdout=$child.StandardOutput.ReadToEndAsync()
          $stderr=$child.StandardError.ReadToEndAsync()
          if(-not $child.WaitForExit(150000)){
            $child.Kill()
            $reply.cliResult=@{exitCode=-1;stdout='';stderr='NV07_HELPER_TIMEOUT';timedOut=$true}
          }else{
            $text=[string]$stdout.Result
            if($text.Length -gt 1048576 -or $child.ExitCode -ne 0){throw 'NV07_HELPER_OUTPUT_DENIED'}
            $reply.cliResult=$text|ConvertFrom-Json
          }
        }finally{$child.Dispose()}
        $reply.invocationId=$invocationId
        $reply.at=[DateTime]::UtcNow.ToString('o')
      }
      $writer.WriteLine(($reply | ConvertTo-Json -Depth 6 -Compress))
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
