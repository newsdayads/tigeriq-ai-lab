param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$control='F:\TigerIQ\Worker\control_plane_v2.py'
$task='TigerIQ Worker'
$marker='# TIGERIQ_CONTROLLER_STATUS_V1_CONTRACT'
$backupDir=Join-Path 'F:\TigerIQ\Worker\backup' ("controller-status-v1-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$backup=Join-Path $backupDir 'control_plane_v2.py'
$patched=$false

function Fail([string]$code,[string]$msg){ throw "$code`: $msg" }
function Restart-Worker {
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $task -ErrorAction Stop
  $deadline=(Get-Date).AddSeconds(30)
  do { Start-Sleep -Seconds 2; $t=Get-ScheduledTask -TaskName $task -ErrorAction Stop; if($t.State -eq 'Running'){ return } } while((Get-Date)-lt $deadline)
  Fail 'WORKER_RESTART_TIMEOUT' 'TigerIQ Worker did not reach Running.'
}

$old=@'
def workforce_status():
    ip = tailscale_ipv4()
    url = f'http://{ip}:{WORKFORCE_PORT}/api/workforce/status'
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            body = response.read(256000)
            code = int(response.status)
    except Exception as exc:
        return {'ok': False, 'action': 'workforce.controller.status', 'host': ip, 'port': WORKFORCE_PORT, 'http_status': None, 'error': f'{type(exc).__name__}: {exc}', 'listener': listener_status()}
    listeners = listener_status()
    expected = [row for row in listeners.get('listeners', []) if row.get('address') == ip]
    return {
        'ok': code == 200 and bool(expected) and listeners.get('ok') and not listeners.get('wildcard_listener'),
        'action': 'workforce.controller.status',
        'host': ip,
        'port': WORKFORCE_PORT,
        'http_status': code,
        'body_sha256': hashlib.sha256(body).hexdigest(),
        'listener': listeners,
    }


'@
$new=@'
def workforce_status():
    # TIGERIQ_CONTROLLER_STATUS_V1_CONTRACT
    ip = tailscale_ipv4()
    listeners = listener_status()
    expected = [row for row in listeners.get('listeners', []) if row.get('address') == ip]
    listener_ok = bool(expected) and listeners.get('ok') and not listeners.get('wildcard_listener') and not listeners.get('public_listener')
    attempts = []
    contracts = (
        ('controller-v1', '/api/v1/status'),
        ('legacy-workforce', '/api/workforce/status'),
    )
    for contract, path in contracts:
        url = f'http://{ip}:{WORKFORCE_PORT}{path}'
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                body = response.read(256000)
                code = int(response.status)
        except Exception as exc:
            status = getattr(exc, 'code', None)
            attempts.append({'contract': contract, 'path': path, 'http_status': status, 'error_class': type(exc).__name__})
            if status == 404:
                continue
            return {
                'ok': False,
                'action': 'workforce.controller.status',
                'host': ip,
                'port': WORKFORCE_PORT,
                'contract': contract,
                'path': path,
                'http_status': status,
                'error': f'{type(exc).__name__}: {exc}',
                'attempts': attempts,
                'listener': listeners,
            }
        try:
            payload = json.loads(body.decode('utf-8'))
        except Exception:
            payload = None
        body_ok = isinstance(payload, dict) and payload.get('ok') is True
        contract_ok = body_ok
        postgres = None
        migration = None
        protocol = None
        if contract == 'controller-v1':
            postgres = payload.get('postgres') if isinstance(payload, dict) else None
            migration = payload.get('migration') if isinstance(payload, dict) else None
            protocol = payload.get('protocol') if isinstance(payload, dict) else None
            contract_ok = body_ok and postgres is True and migration == '001_operational_state_v1'
        return {
            'ok': code == 200 and listener_ok and contract_ok,
            'action': 'workforce.controller.status',
            'host': ip,
            'port': WORKFORCE_PORT,
            'contract': contract,
            'path': path,
            'http_status': code,
            'body_sha256': hashlib.sha256(body).hexdigest(),
            'protocol': protocol,
            'postgres': postgres,
            'migration': migration,
            'attempts': attempts,
            'listener': listeners,
        }
    return {
        'ok': False,
        'action': 'workforce.controller.status',
        'host': ip,
        'port': WORKFORCE_PORT,
        'contract': None,
        'http_status': 404,
        'error': 'no supported Workforce Controller status route',
        'attempts': attempts,
        'listener': listeners,
    }


'@

try {
  if($env:COMPUTERNAME -ne 'PC01'){ Fail 'WRONG_HOST' 'PC01 only.' }
  if(-not (Test-Path -LiteralPath $control)){ Fail 'CONTROL_PLANE_MISSING' $control }
  $t=Get-ScheduledTask -TaskName $task -ErrorAction Stop
  $python=[string]$t.Actions[0].Execute
  if(-not $python -or -not (Test-Path -LiteralPath $python)){ Fail 'PYTHON_MISSING' $python }
  $text=[IO.File]::ReadAllText($control).Replace("`r`n","`n")
  $old=$old.Replace("`r`n","`n")
  $new=$new.Replace("`r`n","`n")

  if($text.Contains($marker)){
    if(-not $text.Contains("'/api/v1/status'") -or -not $text.Contains("'/api/workforce/status'")){ Fail 'STATUS_MARKER_INCONSISTENT' 'Marker exists without reviewed V1/fallback routes.' }
    if($t.State -ne 'Running'){ Start-ScheduledTask -TaskName $task -ErrorAction Stop; Start-Sleep -Seconds 2 }
    $t=Get-ScheduledTask -TaskName $task -ErrorAction Stop
    if($t.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING' ([string]$t.State) }
    [ordered]@{status='PASS';controllerStatusContract='READY';patched=$false;workerTask=$t.State.ToString()}|ConvertTo-Json -Compress
    exit 0
  }

  if(-not $text.Contains($old)){ Fail 'CONTROL_STATUS_LAYOUT_CHANGED' 'Reviewed legacy workforce_status function not found exactly.' }
  if(([regex]::Matches($text,[regex]::Escape($old))).Count -ne 1){ Fail 'CONTROL_STATUS_LAYOUT_AMBIGUOUS' 'Legacy workforce_status function must match exactly once.' }

  New-Item -ItemType Directory -Force -Path $backupDir|Out-Null
  Copy-Item -LiteralPath $control -Destination $backup -Force
  $text=$text.Replace($old,$new)
  $tmp="$control.new"
  [IO.File]::WriteAllText($tmp,$text,(New-Object Text.UTF8Encoding($false)))
  & $python -m py_compile $tmp
  if($LASTEXITCODE -ne 0){ Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; Fail 'PY_COMPILE_FAILED' 'Patched control plane did not compile.' }
  Move-Item -Force -LiteralPath $tmp -Destination $control
  $patched=$true
  Restart-Worker

  $after=[IO.File]::ReadAllText($control)
  if(-not $after.Contains($marker)){ Fail 'STATUS_PATCH_NOT_PERSISTED' 'Controller status V1 marker missing after restart.' }
  if(-not $after.Contains("('controller-v1', '/api/v1/status')")){ Fail 'V1_ROUTE_NOT_PERSISTED' 'Canonical Controller V1 status route missing.' }
  if(-not $after.Contains("('legacy-workforce', '/api/workforce/status')")){ Fail 'LEGACY_FALLBACK_NOT_PERSISTED' 'Compatibility status route missing.' }
  $t=Get-ScheduledTask -TaskName $task -ErrorAction Stop
  if($t.State -ne 'Running'){ Fail 'WORKER_NOT_RUNNING_AFTER_REPAIR' ([string]$t.State) }

  [ordered]@{status='PASS';controllerStatusContract='REPAIRED';patched=$true;workerTask=$t.State.ToString();backup=$backup}|ConvertTo-Json -Compress
  exit 0
} catch {
  $msg=$_.Exception.Message
  if($patched -and (Test-Path -LiteralPath $backup)){
    try { Copy-Item -LiteralPath $backup -Destination $control -Force; Restart-Worker; $msg+=' | ROLLBACK_OK' } catch { $msg+=' | ROLLBACK_FAILED='+$_.Exception.Message }
  }
  [ordered]@{status='FAIL';error=$msg;backup=$backup}|ConvertTo-Json -Compress
  exit 1
}