param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$control='F:\TigerIQ\Worker\control_plane_v2.py'
$task='TigerIQ Worker'
$expectedPath='/api/workforce/status'
$legacyPaths=@('/api/v1/status','/api/status','/status')
$backupDir=Join-Path 'F:\TigerIQ\Worker\backup' ("controller-status-contract-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$backup=Join-Path $backupDir 'control_plane_v2.py'
$patched=$false

function Fail([string]$code,[string]$msg){ throw "$code`: $msg" }
function Restart-Worker {
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $task -ErrorAction Stop
  $deadline=(Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Seconds 2
    $t=Get-ScheduledTask -TaskName $task -ErrorAction Stop
    if($t.State -eq 'Running'){ return }
  } while((Get-Date)-lt $deadline)
  Fail 'WORKER_RESTART_TIMEOUT' 'TigerIQ Worker did not reach Running.'
}

try {
  if($env:COMPUTERNAME -ne 'PC01'){ Fail 'WRONG_HOST' 'PC01 only.' }
  if(-not (Test-Path -LiteralPath $control)){ Fail 'CONTROL_PLANE_MISSING' $control }
  $t=Get-ScheduledTask -TaskName $task -ErrorAction Stop
  $python=[string]$t.Actions[0].Execute
  if(-not $python -or -not (Test-Path -LiteralPath $python)){ Fail 'PYTHON_MISSING' $python }

  $text=[IO.File]::ReadAllText($control).Replace("`r`n","`n")
  $start=$text.IndexOf('def workforce_status():')
  if($start -lt 0){ Fail 'STATUS_FUNCTION_MISSING' 'def workforce_status() not found.' }
  $next=$text.IndexOf("`ndef ",$start+1)
  if($next -lt 0){ $next=$text.Length }
  $segment=$text.Substring($start,$next-$start)

  if($segment.Contains($expectedPath)){
    if($t.State -ne 'Running'){ Start-ScheduledTask -TaskName $task -ErrorAction Stop; Start-Sleep -Seconds 2 }
    [ordered]@{status='PASS';contract='READY';healthPath=$expectedPath;patched=$false}|ConvertTo-Json -Compress
    exit 0
  }

  $matches=@($legacyPaths | Where-Object { $segment.Contains($_) })
  if($matches.Count -ne 1){ Fail 'STATUS_PATH_AMBIGUOUS' ("Expected exactly one recognized legacy path; found {0}." -f $matches.Count) }

  New-Item -ItemType Directory -Force -Path $backupDir|Out-Null
  Copy-Item -LiteralPath $control -Destination $backup -Force

  $legacy=[string]$matches[0]
  $patchedSegment=$segment.Replace($legacy,$expectedPath)
  if(-not $patchedSegment.Contains($expectedPath) -or $patchedSegment.Contains($legacy)){ Fail 'STATUS_PATH_PATCH_FAILED' 'Could not normalize Controller status path.' }
  $patchedText=$text.Substring(0,$start)+$patchedSegment+$text.Substring($next)

  $tmp="$control.new"
  [IO.File]::WriteAllText($tmp,$patchedText,(New-Object Text.UTF8Encoding($false)))
  & $python -m py_compile $tmp
  if($LASTEXITCODE -ne 0){ Fail 'PY_COMPILE_FAILED' 'Patched control plane did not compile.' }
  Move-Item -Force -LiteralPath $tmp -Destination $control
  $patched=$true
  Restart-Worker

  $after=[IO.File]::ReadAllText($control).Replace("`r`n","`n")
  $afterStart=$after.IndexOf('def workforce_status():')
  $afterNext=$after.IndexOf("`ndef ",$afterStart+1)
  if($afterNext -lt 0){ $afterNext=$after.Length }
  if($afterStart -lt 0){ Fail 'PATCH_NOT_PERSISTED' 'workforce_status missing after restart.' }
  $afterSegment=$after.Substring($afterStart,$afterNext-$afterStart)
  if(-not $afterSegment.Contains($expectedPath)){ Fail 'PATCH_NOT_PERSISTED' 'Expected status path missing after restart.' }

  [ordered]@{status='PASS';contract='REPAIRED';healthPath=$expectedPath;legacyPath=$legacy;patched=$true;backup=$backup}|ConvertTo-Json -Compress
  exit 0
} catch {
  $msg=$_.Exception.Message
  if($patched -and (Test-Path -LiteralPath $backup)){
    try { Copy-Item -LiteralPath $backup -Destination $control -Force; Restart-Worker; $msg+=' | ROLLBACK_OK' } catch { $msg+=' | ROLLBACK_FAILED='+$_.Exception.Message }
  }
  [ordered]@{status='FAIL';error=$msg;backup=$backup}|ConvertTo-Json -Compress
  exit 1
}
