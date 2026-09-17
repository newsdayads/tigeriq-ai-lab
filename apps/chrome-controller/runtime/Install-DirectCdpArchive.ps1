param(
  [string]$BridgePath = 'D:\TigerIQ\Apps\ChromeController\Runtime\direct-cdp-bridge.mjs',
  [string]$ModuleSourcePath = (Join-Path $PSScriptRoot 'direct-cdp-archive.mjs'),
  [switch]$RestartBridge
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-TextSha256([string]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

if (-not (Test-Path -LiteralPath $BridgePath)) { throw "BRIDGE_NOT_FOUND:$BridgePath" }
if (-not (Test-Path -LiteralPath $ModuleSourcePath)) { throw "ARCHIVE_MODULE_NOT_FOUND:$ModuleSourcePath" }

$raw = [IO.File]::ReadAllText($BridgePath)
$tokenMatch = [regex]::Match($raw, '(?m)^const NV02_TOKEN=.*;$')
if (-not $tokenMatch.Success) { throw 'BRIDGE_TOKEN_ANCHOR_NOT_FOUND' }
$tokenFingerprintBefore = Get-TextSha256 $tokenMatch.Value

$importLine = "import { runDirectCdpArchive } from './direct-cdp-archive.mjs';"
$patched = $raw
if (-not $patched.Contains($importLine)) {
  $importAnchor = "import http from 'node:http';"
  if (-not $patched.Contains($importAnchor)) { throw 'BRIDGE_IMPORT_ANCHOR_NOT_FOUND' }
  $patched = $patched.Replace($importAnchor, "$importAnchor`r`n$importLine")
}

$archiveBranch = @'
  if(action==='ARCHIVE_CHAT'){
    return runDirectCdpArchive({
      workerId:w.id,
      target,
      payload,
      getJson:async(path)=>{
        const r=await fetch(CONTROLLER+path,{headers:auth(w.id),signal:AbortSignal.timeout(4000)});
        if(!r.ok) throw new Error(`HTTP_${r.status}:${path}`);
        return r.json();
      },
      dispatch:(text)=>dispatch(target,text),
      uiState:()=>uiState(target),
      evaluate:async(expression)=>{
        const p=await pageRpc(target);
        try{return (await p.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},12000)).result.value;}
        finally{p.close();}
      }
    });
  }
'@

if (-not $patched.Contains("if(action==='ARCHIVE_CHAT')")) {
  $unknownAnchor = '  throw new Error(`UNKNOWN_ACTION:${action}`);'
  if (-not $patched.Contains($unknownAnchor)) { throw 'BRIDGE_COMMAND_ANCHOR_NOT_FOUND' }
  $patched = $patched.Replace($unknownAnchor, "$archiveBranch`r`n$unknownAnchor")
}

$tokenMatchAfter = [regex]::Match($patched, '(?m)^const NV02_TOKEN=.*;$')
if (-not $tokenMatchAfter.Success) { throw 'BRIDGE_TOKEN_ANCHOR_LOST' }
$tokenFingerprintAfter = Get-TextSha256 $tokenMatchAfter.Value
if ($tokenFingerprintAfter -ne $tokenFingerprintBefore) { throw 'BRIDGE_CREDENTIAL_MUTATION_FORBIDDEN' }

$bridgeDir = Split-Path -Parent $BridgePath
$moduleTarget = Join-Path $bridgeDir 'direct-cdp-archive.mjs'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$BridgePath.pre802-$timestamp.bak"
Copy-Item -LiteralPath $BridgePath -Destination $backup -Force

$tempBridge = "$BridgePath.tmp802"
$tempModule = "$moduleTarget.tmp802"
[IO.File]::WriteAllText($tempBridge, $patched, [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath $ModuleSourcePath -Destination $tempModule -Force
Move-Item -LiteralPath $tempModule -Destination $moduleTarget -Force
Move-Item -LiteralPath $tempBridge -Destination $BridgePath -Force

$bridgeSha = (Get-FileHash -LiteralPath $BridgePath -Algorithm SHA256).Hash.ToLowerInvariant()
$moduleSha = (Get-FileHash -LiteralPath $moduleTarget -Algorithm SHA256).Hash.ToLowerInvariant()
$restartInfo = $null

if ($RestartBridge) {
  $escaped = [regex]::Escape($BridgePath)
  $existing = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match $escaped })
  foreach ($process in $existing) { Stop-Process -Id $process.ProcessId -Force }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $newProcess = Start-Process -FilePath $node -ArgumentList @($BridgePath) -WindowStyle Hidden -PassThru
  $healthy = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8799/health' -TimeoutSec 2
      if ($health.ok -eq $true) { $healthy = $true; break }
    } catch { }
  }
  if (-not $healthy) {
    Stop-Process -Id $newProcess.Id -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath $backup -Destination $BridgePath -Force
    throw 'BRIDGE_RESTART_HEALTH_FAILED_ROLLBACK_APPLIED'
  }
  $restartInfo = @{ oldPids = @($existing.ProcessId); newPid = $newProcess.Id; health = 'PASS' }
}

[pscustomobject]@{
  ok = $true
  bridgePath = $BridgePath
  modulePath = $moduleTarget
  credentialUnchanged = ($tokenFingerprintBefore -eq $tokenFingerprintAfter)
  bridgeSha256 = $bridgeSha
  moduleSha256 = $moduleSha
  backupPath = $backup
  restart = $restartInfo
} | ConvertTo-Json -Depth 4
