param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$control='F:\TigerIQ\Worker\control_plane_v2.py'
$task='TigerIQ Worker'
$markerV1='# TIGERIQ_CONTROLLER_DIAGNOSE_V1'
$markerV2='# TIGERIQ_CONTROLLER_DIAGNOSE_V2'
$markerV3='# TIGERIQ_CONTROLLER_DIAGNOSE_V3'
$backupDir=Join-Path 'F:\TigerIQ\Worker\backup' ("controller-diagnose-v3-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
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

$functionAnchor=@'
def workforce_build():
'@
$diagnose=@'
def workforce_diagnose():
    import re

    entry = WORKSPACE / 'dist' / 'apps' / 'workforce-controller' / 'src' / 'standalone.js'
    db_url_file = Path(r'F:\TigerIQ\Secrets\workforce-controller-v1.database-url')
    pgpass_file = Path(r'F:\TigerIQ\Secrets\workforce-controller-v1.pgpass')
    runner = Path(r'F:\TigerIQ\Runtime\workforce-controller-v1\run-workforce-controller-v1.ps1')
    scheduled_log = Path(r'F:\TigerIQ\Logs\workforce-controller-v1.log')
    ensure_log = WORKER_DIR / 'workforce-controller.log'
    self_heal_state = Path(r'F:\TigerIQ\CommandCenter\worker-self-heal-v1.json')
    pg_package = WORKSPACE / 'node_modules' / 'pg' / 'package.json'

    def classify_text(text):
        lowered = str(text or '').lower()
        classes = (
            ('PASSWORD_AUTH_FAILED', 'password authentication failed'),
            ('DATABASE_URL_MISSING', 'tigeriq_database_url is required'),
            ('MODULE_NOT_FOUND', 'cannot find module'),
            ('ERR_MODULE_NOT_FOUND', 'err_module_not_found'),
            ('ECONNREFUSED', 'econnrefused'),
            ('CONNECTION_REFUSED', 'connection refused'),
            ('PGPASS_PERMISSION', 'password file'),
            ('ACCESS_DENIED', 'access is denied'),
            ('CONTROLLER_LISTENER_NOT_READY', 'controller_listener_not_ready'),
            ('CONTROLLER_HTTP_UNHEALTHY', 'controller_http_unhealthy'),
            ('CONTROLLER_STATUS_NOT_OK', 'controller_status_not_ok'),
            ('CONTROLLER_POSTGRES_NOT_READY', 'controller_postgres_not_ready'),
            ('CONTROLLER_MIGRATION_NOT_READY', 'controller_migration_not_ready'),
            ('PG_IMPORT_FAILED', 'pg_import_failed'),
            ('PG_INSTALL_FAILED', 'pg_install_failed'),
            ('TRACKED_PACKAGE_MUTATION', 'tracked_package_mutation'),
            ('PSQL_MISSING', 'psql_missing'),
            ('NODE_PATH_MISSING', 'node_path_missing'),
        )
        found = [name for name, needle in classes if needle in lowered]
        return found[0] if found else 'UNCLASSIFIED'

    def classify(path):
        if not path.exists():
            return {'exists': False, 'sha256': None, 'error_class': 'MISSING'}
        try:
            raw = path.read_bytes()[-131072:]
            text = raw.decode('utf-8', errors='replace')
            digest = hashlib.sha256(raw).hexdigest()
            return {'exists': True, 'sha256': digest, 'error_class': classify_text(text)}
        except Exception as exc:
            return {'exists': True, 'sha256': None, 'error_class': f'READ_FAILED:{type(exc).__name__}'}

    def read_secret_meta(path):
        if not path.exists():
            return {'exists': False, 'read_ok': False, 'nonempty': False, 'error_class': 'MISSING'}, None
        try:
            value = path.read_text(encoding='utf-8', errors='strict').strip()
            return {'exists': True, 'read_ok': True, 'nonempty': bool(value), 'error_class': 'NONE'}, value
        except Exception as exc:
            return {'exists': True, 'read_ok': False, 'nonempty': False, 'error_class': f'READ_FAILED:{type(exc).__name__}'}, None

    def append_open_ok(path):
        if not path.exists():
            return False
        try:
            fd = os.open(path, os.O_WRONLY | os.O_APPEND)
            os.close(fd)
            return True
        except Exception:
            return False

    def runner_meta():
        if not runner.exists():
            return {'exists': False, 'sha256': None, 'powershell_parse_ok': False}
        try:
            raw = runner.read_bytes()
            text = raw.decode('utf-8', errors='replace')
            powershell = _resolve_executable('powershell.exe', (r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',))
            parse_cmd = "$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('F:\\TigerIQ\\Runtime\\workforce-controller-v1\\run-workforce-controller-v1.ps1',[ref]$t,[ref]$e);if($e.Count -eq 0){exit 0}else{exit 2}"
            parsed = _run([powershell, '-NoProfile', '-NonInteractive', '-Command', parse_cmd], timeout=15, cwd=WORKER_DIR)
            invoke = re.search(r"&\s*'([^']+)'\s*'([^']+)'", text)
            redirect = re.search(r"\*>>\s*'([^']+)'", text)
            runner_node = Path(invoke.group(1)) if invoke else None
            runner_entry = Path(invoke.group(2)) if invoke else None
            runner_log = Path(redirect.group(1)) if redirect else None
            worker_node = Path(_node_exe())
            node_exists = bool(runner_node and runner_node.exists())
            node_matches = bool(runner_node and node_exists and runner_node.resolve() == worker_node.resolve())
            entry_matches = bool(runner_entry and runner_entry.exists() and runner_entry.resolve() == entry.resolve())
            log_matches = bool(runner_log and runner_log.exists() and runner_log.resolve() == scheduled_log.resolve())
            node_pg_import_ok = False
            if node_exists:
                import_probe = _run([str(runner_node), '-e', "import('pg').then(()=>process.exit(0)).catch(()=>process.exit(2))"], timeout=20, cwd=WORKSPACE)
                node_pg_import_ok = import_probe.get('returncode') == 0
            return {
                'exists': True,
                'sha256': hashlib.sha256(raw).hexdigest(),
                'readable_by_worker': os.access(runner, os.R_OK),
                'powershell_parse_ok': parsed.get('returncode') == 0,
                'sets_database_url': "TIGERIQ_DATABASE_URL" in text and 'ReadAllText' in text,
                'sets_expected_host': "TIGERIQ_WORKFORCE_HOST" in text and '100.97.23.87' in text,
                'sets_expected_port': "TIGERIQ_WORKFORCE_PORT" in text and '8790' in text,
                'sets_pgpassfile': 'PGPASSFILE' in text,
                'redirects_controller_log': 'workforce-controller-v1.log' in text,
                'node_executable_exists': node_exists,
                'node_matches_worker_node': node_matches,
                'entry_invocation_matches': entry_matches,
                'log_redirection_target_matches': log_matches,
                'runner_node_pg_import_ok': node_pg_import_ok,
            }
        except Exception as exc:
            return {'exists': True, 'sha256': None, 'powershell_parse_ok': False, 'error_class': f'RUNNER_READ_FAILED:{type(exc).__name__}'}

    def task_meta():
        result = _run(['schtasks', '/Query', '/TN', 'TigerIQ Workforce Controller', '/FO', 'LIST', '/V'], timeout=20, cwd=WORKER_DIR)
        status = None
        last_result = None
        if result.get('returncode') == 0:
            for raw in result.get('stdout', '').splitlines():
                line = raw.strip()
                lowered = line.lower()
                if lowered.startswith('status:') and status is None:
                    status = line.split(':', 1)[1].strip()
                if lowered.startswith('last result:') and last_result is None:
                    last_result = line.split(':', 1)[1].strip()
        return {'query_ok': result.get('returncode') == 0, 'status': status, 'last_result': last_result}

    def self_heal_meta():
        if not self_heal_state.exists():
            return {'exists': False, 'result': None, 'error_class': 'MISSING'}
        try:
            data = json.loads(self_heal_state.read_text(encoding='utf-8', errors='replace'))
            error = data.get('error') if isinstance(data, dict) else None
            return {
                'exists': True,
                'result': data.get('result') if isinstance(data, dict) else None,
                'controller_runtime': data.get('controllerRuntime') if isinstance(data, dict) else None,
                'error_class': classify_text(error),
            }
        except Exception as exc:
            return {'exists': True, 'result': None, 'error_class': f'SELF_HEAL_READ_FAILED:{type(exc).__name__}'}

    def postgres_probe():
        db_meta, db_url = read_secret_meta(db_url_file)
        pgpass_meta, _ = read_secret_meta(pgpass_file)
        base = {
            'database_url_read_ok': db_meta['read_ok'],
            'database_url_nonempty': db_meta['nonempty'],
            'pgpass_read_ok': pgpass_meta['read_ok'],
            'pgpass_nonempty': pgpass_meta['nonempty'],
            'database_url_secret_free': None,
            'psql_available': False,
            'migration_ok': False,
            'error_class': 'UNCLASSIFIED',
        }
        if not db_meta['read_ok'] or not db_meta['nonempty']:
            base['error_class'] = db_meta['error_class'] if not db_meta['read_ok'] else 'DATABASE_URL_EMPTY'
            return base
        if not pgpass_meta['read_ok'] or not pgpass_meta['nonempty']:
            base['error_class'] = pgpass_meta['error_class'] if not pgpass_meta['read_ok'] else 'PGPASS_EMPTY'
            return base
        secret_form = bool(re.search(r'://[^/@:]+:[^/@]+@', db_url or '') or re.search(r'(?i)password=', db_url or ''))
        base['database_url_secret_free'] = not secret_form
        if secret_form:
            base['error_class'] = 'DATABASE_URL_SECRET_FORM'
            return base
        try:
            psql = _resolve_executable('psql.exe', (r'C:\Program Files\PostgreSQL\17\bin\psql.exe', r'C:\Program Files\PostgreSQL\16\bin\psql.exe'))
        except Exception:
            base['error_class'] = 'PSQL_MISSING'
            return base
        base['psql_available'] = True
        env = os.environ.copy()
        env['PGPASSFILE'] = str(pgpass_file)
        result = _run([psql, db_url, '-v', 'ON_ERROR_STOP=1', '-Atc', "SELECT version FROM tigeriq_schema_migrations WHERE version='001_operational_state_v1';"], timeout=20, cwd=WORKER_DIR, env=env)
        migration_ok = result.get('returncode') == 0 and '001_operational_state_v1' in result.get('stdout', '')
        base['migration_ok'] = migration_ok
        base['error_class'] = 'NONE' if migration_ok else classify_text((result.get('stderr') or '') + ' ' + (result.get('stdout') or ''))
        if not migration_ok and base['error_class'] == 'UNCLASSIFIED':
            base['error_class'] = 'POSTGRES_PROBE_FAILED'
        return base

    db_meta, _ = read_secret_meta(db_url_file)
    pgpass_meta, _ = read_secret_meta(pgpass_file)
    return {
        'ok': True,
        'action': 'workforce.controller.diagnose',
        'diagnostic_version': 3,
        'workspace': str(WORKSPACE),
        'entry_exists': entry.exists(),
        'pg_module_exists': pg_package.exists(),
        'database_url_file': db_meta,
        'pgpass_file': pgpass_meta,
        'worker_env_database_url_present': bool(os.environ.get('TIGERIQ_DATABASE_URL')),
        'worker_env_pgpassfile_present': bool(os.environ.get('PGPASSFILE')),
        'runner': runner_meta(),
        'task': task_meta(),
        'scheduled_log': classify(scheduled_log),
        'scheduled_log_append_open_ok': append_open_ok(scheduled_log),
        'ensure_log': classify(ensure_log),
        'self_heal': self_heal_meta(),
        'postgres_probe': postgres_probe(),
        'listener': listener_status(),
    }


'@
$actionAnchor=@'
    if action == 'workforce.controller.build':
'@
$actionInsert=@'
    if action == 'workforce.controller.diagnose':
        if args:
            raise ValueError('workforce diagnose takes no arguments')
        return workforce_diagnose()
    if action == 'workforce.controller.build':
'@

try {
  if($env:COMPUTERNAME -ne 'PC01'){ Fail 'WRONG_HOST' 'PC01 only.' }
  if(-not (Test-Path -LiteralPath $control)){ Fail 'CONTROL_PLANE_MISSING' $control }
  $t=Get-ScheduledTask -TaskName $task -ErrorAction Stop
  $python=[string]$t.Actions[0].Execute
  if(-not $python -or -not (Test-Path -LiteralPath $python)){ Fail 'PYTHON_MISSING' $python }
  $text=[IO.File]::ReadAllText($control).Replace("`r`n","`n")
  if($text.Contains($markerV3)){
    if($t.State -ne 'Running'){ Start-ScheduledTask -TaskName $task -ErrorAction Stop; Start-Sleep 2 }
    [ordered]@{status='PASS';diagnose='READY';version=3;patched=$false}|ConvertTo-Json -Compress
    exit 0
  }

  $diagnose=$diagnose.Replace("`r`n","`n")
  $functionAnchor=$functionAnchor.Replace("`r`n","`n")
  $actionAnchor=$actionAnchor.Replace("`r`n","`n")
  $actionInsert=$actionInsert.Replace("`r`n","`n")

  New-Item -ItemType Directory -Force -Path $backupDir|Out-Null
  Copy-Item -LiteralPath $control -Destination $backup -Force

  if($text.Contains($markerV1) -or $text.Contains($markerV2)){
    $start=$text.IndexOf('def workforce_diagnose():')
    $finish=$text.IndexOf('def workforce_build():',$start)
    if($start -lt 0 -or $finish -le $start){ Fail 'PRIOR_LAYOUT_CHANGED' 'Could not locate existing diagnose function boundaries.' }
    if(-not $text.Contains("if action == 'workforce.controller.diagnose':")){ Fail 'PRIOR_ACTION_MISSING' 'Existing diagnose action missing.' }
    $text=$text.Substring(0,$start)+$diagnose+$text.Substring($finish)
    $text=$text.Replace($markerV1,$markerV3).Replace($markerV2,$markerV3)
  } else {
    if(-not $text.Contains('WORKFORCE_PORT = 8790')){ Fail 'CONTROL_LAYOUT_CHANGED' 'WORKFORCE_PORT anchor missing.' }
    if(-not $text.Contains($functionAnchor)){ Fail 'CONTROL_FUNCTION_ANCHOR_CHANGED' 'workforce_build anchor missing.' }
    if(-not $text.Contains($actionAnchor)){ Fail 'CONTROL_ACTION_ANCHOR_CHANGED' 'workforce build action anchor missing.' }
    $text=$text.Replace('WORKFORCE_PORT = 8790',"WORKFORCE_PORT = 8790`n$markerV3")
    $text=$text.Replace($functionAnchor,$diagnose+$functionAnchor)
    $text=$text.Replace($actionAnchor,$actionInsert)
  }

  $tmp="$control.new"
  [IO.File]::WriteAllText($tmp,$text,(New-Object Text.UTF8Encoding($false)))
  & $python -m py_compile $tmp
  if($LASTEXITCODE -ne 0){ Fail 'PY_COMPILE_FAILED' 'Patched control plane did not compile.' }
  Move-Item -Force -LiteralPath $tmp -Destination $control
  $patched=$true
  Restart-Worker
  $after=[IO.File]::ReadAllText($control)
  if(-not $after.Contains($markerV3) -or -not $after.Contains("'diagnostic_version': 3") -or -not $after.Contains("workforce.controller.diagnose")){ Fail 'PATCH_NOT_PERSISTED' 'Diagnostic V3 action missing after restart.' }
  [ordered]@{status='PASS';diagnose='REPAIRED';version=3;patched=$true;backup=$backup}|ConvertTo-Json -Compress
  exit 0
} catch {
  $msg=$_.Exception.Message
  if($patched -and (Test-Path -LiteralPath $backup)){
    try { Copy-Item -LiteralPath $backup -Destination $control -Force; Restart-Worker; $msg+=' | ROLLBACK_OK' } catch { $msg+=' | ROLLBACK_FAILED='+$_.Exception.Message }
  }
  [ordered]@{status='FAIL';error=$msg;backup=$backup}|ConvertTo-Json -Compress
  exit 1
}
