Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Get-Nv03ActiveConsoleSessionId {
  if (-not ('TigerIQ.Nv03NativeSessions' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace TigerIQ {
  public static class Nv03NativeSessions {
    [DllImport("kernel32.dll")]
    public static extern UInt32 WTSGetActiveConsoleSessionId();
  }
}
'@
  }
  [uint32]$session=[TigerIQ.Nv03NativeSessions]::WTSGetActiveConsoleSessionId()
  if ($session -eq [uint32]::MaxValue -or $session -eq 0) {
    throw 'NV03_NO_INTERACTIVE_SESSION'
  }
  $explorer=@(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { [int]$_.SessionId -eq [int]$session })
  if ($explorer.Count -lt 1) {
    throw ('NV03_INTERACTIVE_EXPLORER_MISSING:session='+$session)
  }
  return [int]$session
}

function Get-Nv03PortOwner {
  param([Parameter(Mandatory=$true)][int]$Port)
  $listeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 1) { throw ('NV03_PORT_MULTIPLE_LISTENERS:'+$Port) }
  if ($listeners.Count -eq 0) { return 0 }
  return [int]$listeners[0].OwningProcess
}

function Get-Nv03ProcessSnapshot {
  param([int]$Pid,[ValidateSet('chrome','sidecar')][string]$Kind)
  if ($Pid -le 0) {
    return [pscustomobject]@{ listening=$false; pid=0; sessionId=$null; scopeMatched=$true; commandLine='' }
  }
  $p=Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $Pid) -ErrorAction SilentlyContinue
  $gp=Get-Process -Id $Pid -ErrorAction SilentlyContinue
  if (-not $p -or -not $gp) {
    return [pscustomobject]@{ listening=$false; pid=$Pid; sessionId=$null; scopeMatched=$false; commandLine='' }
  }
  $cmd=[string]$p.CommandLine
  $matched=$false
  if ($Kind -eq 'chrome') {
    $matched=([string]$p.Name -ieq 'chrome.exe') -and
      ($cmd -match '--remote-debugging-port=9223') -and
      ($cmd -match 'NV03-Worker[\\/]UserData')
  } else {
    $matched=([string]$p.Name -ieq 'node.exe') -and
      ($cmd -match 'NV03Sidecar') -and
      ($cmd -match 'nv03-isolated-sidecar\.mjs')
  }
  return [pscustomobject]@{
    listening=$true
    pid=[int]$Pid
    sessionId=[int]$gp.SessionId
    scopeMatched=[bool]$matched
    commandLine=$cmd
  }
}

function Get-Nv03RuntimeSnapshot {
  $active=Get-Nv03ActiveConsoleSessionId
  $chromePid=Get-Nv03PortOwner -Port 9223
  $sidecarPid=Get-Nv03PortOwner -Port 8823
  [pscustomobject]@{
    activeSessionId=$active
    chrome=Get-Nv03ProcessSnapshot -Pid $chromePid -Kind chrome
    sidecar=Get-Nv03ProcessSnapshot -Pid $sidecarPid -Kind sidecar
  }
}

function Get-Nv03RuntimeState {
  param($Snapshot=(Get-Nv03RuntimeSnapshot))
  $active=[int]$Snapshot.activeSessionId
  if ($active -le 0) { return 'NO_INTERACTIVE_SESSION' }
  if (($Snapshot.chrome.listening -and -not $Snapshot.chrome.scopeMatched) -or
      ($Snapshot.sidecar.listening -and -not $Snapshot.sidecar.scopeMatched)) {
    return 'SCOPE_MISMATCH'
  }
  if (-not $Snapshot.chrome.listening -or -not $Snapshot.sidecar.listening) {
    return 'NOT_RUNNING'
  }
  if ([int]$Snapshot.chrome.sessionId -ne $active -or [int]$Snapshot.sidecar.sessionId -ne $active) {
    return 'WRONG_WINDOWS_SESSION'
  }
  return 'HEALTHY_INTERACTIVE'
}

function Stop-Nv03ScopedRuntime {
  param($Snapshot=(Get-Nv03RuntimeSnapshot),[switch]$WrongSessionOnly)
  $active=[int]$Snapshot.activeSessionId
  foreach ($entry in @($Snapshot.sidecar,$Snapshot.chrome)) {
    if (-not $entry.listening) { continue }
    if (-not $entry.scopeMatched) { throw ('NV03_SCOPE_MISMATCH_REFUSE_STOP:pid='+$entry.pid) }
    if ($WrongSessionOnly -and [int]$entry.sessionId -eq $active) { continue }
    Stop-Process -Id ([int]$entry.pid) -Force -ErrorAction Stop
  }
}

function Wait-Nv03Port {
  param([Parameter(Mandatory=$true)][int]$Port,[int]$Seconds=20)
  $deadline=(Get-Date).AddSeconds($Seconds)
  do {
    $pid=Get-Nv03PortOwner -Port $Port
    if ($pid -gt 0) { return $pid }
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)
  throw ('NV03_PORT_TIMEOUT:'+$Port)
}

Export-ModuleMember -Function Get-Nv03ActiveConsoleSessionId,Get-Nv03PortOwner,Get-Nv03ProcessSnapshot,Get-Nv03RuntimeSnapshot,Get-Nv03RuntimeState,Stop-Nv03ScopedRuntime,Wait-Nv03Port
