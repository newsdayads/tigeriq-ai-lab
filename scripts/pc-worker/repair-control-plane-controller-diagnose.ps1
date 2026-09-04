param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$control='F:\TigerIQ\Worker\control_plane_v2.py'
$task='TigerIQ Worker'
$marker='# TIGERIQ_CONTROLLER_DIAGNOSE_V1'
$backupDir=Join-Path 'F:\TigerIQ\Worker\backup' ("controller-diagnose-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
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
    entry = WORKSPACE / 'dist' / 'apps' / 'workforce-controller' / 'src' / 'standalone.js'
    db_url_file = Path(r'F:\TigerIQ\Secrets\workforce-controller-v1.database-url')
    pgpass_file = Path(r'F:\TigerIQ\Secrets\workforce-controller-v1.pgpass')
    scheduled_log = Path(r'F:\TigerIQ\Logs\workforce-controller-v1.log')
    ensure_log = WORKER_DIR / 'workforce-controller.log'
    pg_package = WORKSPACE / 'node_modules' / 'pg' / 'package.json'

    def classify(path):
        if not path.exists():
            return {'exists': False, 'sha256': None, 'error_class': 'MISSING'}
        try:
            raw = path.read_bytes()[-131072:]
            text = raw.decode('utf-8', errors='replace').lower()
            digest = hashlib.sha256(raw).hexdigest()
            classes = (
                ('PASSWORD_AUTH_FAILED', 'password authentication failed'),
                ('DATABASE_URL_MISSING', 'tigeriq_database_url is required'),
                ('MODULE_NOT_FOUND', 'cannot find module'),
                ('ERR_MODULE_NOT_FOUND', 'err_module_not_found'),
                ('ECONNREFUSED', 'econnrefused'),
                ('CONNECTION_REFUSED', 'connection refused'),
                ('PGPASS_PERMISSION', 'password file'),
            )
            found = [name for name, needle in classes if needle in text]
            return {'exists': True, 'sha256': digest, 'error_class': found[0] if found else 'UNCLASSIFIED'}
        except Exception as exc:
            return {'exists': True, 'sha256': None, 'error_class': f'READ_FAILED:{type(exc).__name__}'}

    return {
        'ok': True,
        'action': 'workforce.controller.diagnose',
        'workspace': str(WORKSPACE),
        'entry_exists': entry.exists(),
        'pg_module_exists': pg_package.exists(),
        'database_url_file_exists': db_url_file.exists(),
        'pgpass_file_exists': pgpass_file.exists(),
        'worker_env_database_url_present': bool(os.environ.get('TIGERIQ_DATABASE_URL')),
        'worker_env_pgpassfile_present': bool(os.environ.get('PGPASSFILE')),
        'scheduled_log': classify(scheduled_log),
        'ensure_log': classify(ensure_log),
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
  if($text.Contains($marker)){
    if($t.State -ne 'Running'){ Start-ScheduledTask -TaskName $task -ErrorAction Stop; Start-Sleep 2 }
    [ordered]@{status='PASS';diagnose='READY';patched=$false}|ConvertTo-Json -Compress
    exit 0
  }
  if(-not $text.Contains("WORKFORCE_PORT = 8790")){ Fail 'CONTROL_LAYOUT_CHANGED' 'WORKFORCE_PORT anchor missing.' }
  $functionAnchor=$functionAnchor.Replace("`r`n","`n")
  $diagnose=$diagnose.Replace("`r`n","`n")
  $actionAnchor=$actionAnchor.Replace("`r`n","`n")
  $actionInsert=$actionInsert.Replace("`r`n","`n")
  if(-not $text.Contains($functionAnchor)){ Fail 'CONTROL_FUNCTION_ANCHOR_CHANGED' 'workforce_build anchor missing.' }
  if(-not $text.Contains($actionAnchor)){ Fail 'CONTROL_ACTION_ANCHOR_CHANGED' 'workforce build action anchor missing.' }

  New-Item -ItemType Directory -Force -Path $backupDir|Out-Null
  Copy-Item -LiteralPath $control -Destination $backup -Force
  $text=$text.Replace('WORKFORCE_PORT = 8790',"WORKFORCE_PORT = 8790`n$marker")
  $text=$text.Replace($functionAnchor,$diagnose+$functionAnchor)
  $text=$text.Replace($actionAnchor,$actionInsert)
  $tmp="$control.new"
  [IO.File]::WriteAllText($tmp,$text,(New-Object Text.UTF8Encoding($false)))
  & $python -m py_compile $tmp
  if($LASTEXITCODE -ne 0){ Fail 'PY_COMPILE_FAILED' 'Patched control plane did not compile.' }
  Move-Item -Force -LiteralPath $tmp -Destination $control
  $patched=$true
  Restart-Worker
  $after=[IO.File]::ReadAllText($control)
  if(-not $after.Contains($marker) -or -not $after.Contains("workforce.controller.diagnose")){ Fail 'PATCH_NOT_PERSISTED' 'Diagnostic action missing after restart.' }
  [ordered]@{status='PASS';diagnose='REPAIRED';patched=$true;backup=$backup}|ConvertTo-Json -Compress
  exit 0
} catch {
  $msg=$_.Exception.Message
  if($patched -and (Test-Path -LiteralPath $backup)){
    try { Copy-Item -LiteralPath $backup -Destination $control -Force; Restart-Worker; $msg+=' | ROLLBACK_OK' } catch { $msg+=' | ROLLBACK_FAILED='+$_.Exception.Message }
  }
  [ordered]@{status='FAIL';error=$msg;backup=$backup}|ConvertTo-Json -Compress
  exit 1
}
