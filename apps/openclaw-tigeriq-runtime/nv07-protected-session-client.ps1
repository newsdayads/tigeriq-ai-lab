$ErrorActionPreference = 'Stop'
try {
  if ([Environment]::MachineName -ne 'PC01' -or
      [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18') {
    throw 'NV07_TRUSTED_CORE_SYSTEM_CLIENT_REQUIRED'
  }
  $root='C:\ProgramData\TigerIQNV07'
  $brokerPath=$root+'\code\nv07-protected-session-broker.ps1'
  $clientPath=$root+'\code\nv07-protected-session-client.ps1'
  $manifestPath=$root+'\deployment.json'
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class Nv07PeerProof {
 [StructLayout(LayoutKind.Sequential)] struct Mapping {public uint Read,Write,Execute,All;}
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeServerProcessId(IntPtr pipe,out uint pid);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint a,out IntPtr t);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateToken(IntPtr t,int level,out IntPtr d);
 [DllImport("advapi32.dll",SetLastError=true)] static extern bool AccessCheck(byte[] sd,IntPtr t,uint desired,ref Mapping m,IntPtr priv,ref uint len,out uint granted,out bool allowed);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static uint ServerPid(IntPtr pipe) {uint p;if(!GetNamedPipeServerProcessId(pipe,out p))throw new Win32Exception();return p;}
 public static bool Can(byte[] sd,int pid,uint desired) {
  IntPtr t=IntPtr.Zero,d=IntPtr.Zero,b=IntPtr.Zero;
  try {
   using(var process=System.Diagnostics.Process.GetProcessById(pid)){if(!OpenProcessToken(process.Handle,10,out t))throw new Win32Exception();}
   if(!DuplicateToken(t,2,out d))throw new Win32Exception();
   b=Marshal.AllocHGlobal(4096);uint n=4096,grant;bool allowed;
   Mapping m=new Mapping{Read=0x120089,Write=0x120116,Execute=0x1200a0,All=0x1f01ff};
   if(!AccessCheck(sd,d,desired,ref m,b,ref n,out grant,out allowed))throw new Win32Exception();
   return allowed;
  }finally{if(b!=IntPtr.Zero)Marshal.FreeHGlobal(b);if(d!=IntPtr.Zero)CloseHandle(d);if(t!=IntPtr.Zero)CloseHandle(t);}
 }
}
'@
  foreach($p in @($root,($root+'\code'),$brokerPath,$clientPath,$manifestPath)){
    $item=Get-Item -LiteralPath $p -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'NV07_DEPLOYMENT_REPARSE_DENIED'}
    $acl=Get-Acl -LiteralPath $p
    if($acl.Owner -notin @('NT AUTHORITY\SYSTEM','BUILTIN\Administrators')){throw 'NV07_DEPLOYMENT_OWNER_INVALID'}
  }
  $manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
  if($manifest.schema -ne 'NV07_PROTECTED_DEPLOYMENT_V1' -or $manifest.workOrderId -ne 4783 -or
     [string]$manifest.sourceSha -notmatch '^[a-f0-9]{40}$' -or
     [string]$manifest.brokerSha256 -notmatch '^[a-f0-9]{64}$' -or
     [string]$manifest.clientSha256 -notmatch '^[a-f0-9]{64}$'){throw 'NV07_DEPLOYMENT_PIN_INVALID'}
  if((Get-FileHash -LiteralPath $brokerPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.brokerSha256 -or
     (Get-FileHash -LiteralPath $clientPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.clientSha256){throw 'NV07_DEPLOYMENT_BYTES_CHANGED'}
  $pipe=New-Object IO.Pipes.NamedPipeClientStream('.', 'TigerIQ.NV07.4783', [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::Asynchronous)
  try {
    $pipe.Connect(3000)
    $serverPid=[int][Nv07PeerProof]::ServerPid($pipe.SafePipeHandle.DangerousGetHandle())
    $process=Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid"
    $owner=Invoke-CimMethod -InputObject $process -MethodName GetOwner
    $exe='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$brokerPath+'"'
    $expected='"'+$exe+'" '+$arguments
    $alternate=$exe+' '+$arguments
    if($owner.Domain -ne 'PC01' -or $owner.User -ne 'wdragons12x' -or $process.SessionId -le 0 -or
       $process.ExecutablePath -ne $exe -or $process.CommandLine -notin @($expected,$alternate)){throw 'NV07_OS_PIPE_PEER_INVALID'}
    if((Get-AuthenticodeSignature -LiteralPath $exe).Status -ne 'Valid'){throw 'NV07_OS_IMAGE_SIGNATURE_INVALID'}
    $task=Get-ScheduledTask -TaskName 'TigerIQ NV07 Session Broker'
    if($task.State -ne 'Running' -or $task.Principal.UserId -notmatch '(^|\\)wdragons12x$' -or
       [string]$task.Principal.LogonType -ne 'Interactive' -or [string]$task.Principal.RunLevel -ne 'Limited' -or
       @($task.Actions).Count -ne 1 -or $task.Actions[0].Execute -ne $exe -or
       $task.Actions[0].Arguments -ne $arguments){throw 'NV07_TASK_CONFIGURATION_INVALID'}
    # Use the OS task instance's actual execution PID, not a scheduling-time
    # heuristic: a cold/loaded PC01 may start the action over 15 seconds later.
    $scheduler=New-Object -ComObject 'Schedule.Service'
    $scheduler.Connect()
    $instances=@($scheduler.GetFolder('\').GetTask($task.TaskName).GetInstances(0) |
      Where-Object { [int]$_.EnginePID -eq $serverPid -and [int]$_.State -eq 4 })
    if($instances.Count -ne 1){throw 'NV07_TASK_PEER_PID_MISMATCH'}
    foreach($p in @('C:\','C:\ProgramData',$root,($root+'\code'))){
      $item=Get-Item -LiteralPath $p -Force
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'NV07_ANCESTOR_REPARSE_DENIED'}
      $sd=(Get-Acl -LiteralPath $p).GetSecurityDescriptorBinaryForm()
      foreach($right in @(0x40,0x40000,0x80000)){
        if([Nv07PeerProof]::Can($sd,$serverPid,$right)){throw 'NV07_NAMESPACE_REPLACE_OR_DACL_PERMISSION'}
      }
    }
    foreach($p in @($root,($root+'\code'),$brokerPath,$clientPath,$manifestPath)){
      $sd=(Get-Acl -LiteralPath $p).GetSecurityDescriptorBinaryForm()
      foreach($right in @(2,0x10000,0x40000,0x80000)){
        if([Nv07PeerProof]::Can($sd,$serverPid,$right)){throw 'NV07_CODE_OR_ROOT_WRITABLE_BY_USER'}
      }
    }
    $nonce=[guid]::NewGuid().ToString()
    $request=@{schema='NV07_PROTECTED_SESSION_PROBE_V1';action='ATTEST_SESSION_ONLY';nonce=$nonce}|ConvertTo-Json -Compress
    $writer=New-Object IO.StreamWriter($pipe,(New-Object Text.UTF8Encoding($false)),4096,$true)
    $reader=New-Object IO.StreamReader($pipe,(New-Object Text.UTF8Encoding($false)),$false,4096,$true)
    try {
      $writer.AutoFlush=$true;$writer.WriteLine($request)
      $pending=$reader.ReadLineAsync()
      if(-not $pending.Wait(3000)){throw 'NV07_PEER_RESPONSE_TIMEOUT'}
      $line=[string]$pending.Result
      if($line.Length -gt 4096){throw 'NV07_PEER_RESPONSE_TOO_LARGE'}
      $reply=$line|ConvertFrom-Json
      if($reply.ok -ne $true -or $reply.nonce -ne $nonce -or
         $reply.schema -ne 'NV07_PROTECTED_SESSION_PROBE_V1' -or
         $reply.action -ne 'ATTEST_SESSION_ONLY' -or $reply.host -ne 'PC01' -or
         $reply.pid -ne $serverPid -or $reply.sessionId -ne $process.SessionId -or
         $reply.windowsUser -ne 'wdragons12x' -or
         $reply.codeHash -ne $manifest.brokerSha256){throw 'NV07_PEER_RESPONSE_MISMATCH'}
      @{
        accepted=$true;code='NV07_OS_PEER_AND_PROTECTED_CODE_VERIFIED'
        host='PC01';windowsUser='wdragons12x';sessionId=$process.SessionId;pid=$serverPid;taskInstanceGuid=[string]$instances[0].InstanceGuid
        attestationVerified=$true;deviceIdentityVerified=$true
        sourceSha=$manifest.sourceSha;brokerHash=$manifest.brokerSha256
        coreLeaseVerified=$false;nv07Active=$false;at=[DateTime]::UtcNow.ToString('o')
      }|ConvertTo-Json -Depth 4 -Compress
    }finally{$writer.Dispose();$reader.Dispose()}
  }finally{$pipe.Dispose()}
}catch{
  $reason='NV07_NATIVE_IO_ERROR'
  if($_.Exception.Message -match '^NV07_[A-Z_]+$'){$reason=$_.Exception.Message}
  @{accepted=$false;code='NV07_NATIVE_TRUST_NOT_VERIFIED';reason=$reason;attestationVerified=$false;coreLeaseVerified=$false;nv07Active=$false}|ConvertTo-Json -Compress
  exit 1
}
