import hashlib
import json
import os
import subprocess
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

VERSION = '14.2.2'
ISSUE = '441'
REPO = 'newsdayads/tigeriq-ai-lab'
INSTALLER_URL = 'https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/8f0a45c57588a9abb846192517240fb21153f5de/scripts/pc-worker/TigerIQ_AW_14.2.2_installer.ps1'
INSTALLER_SHA256 = '57be6bcfea2cea8afb375842b4b825d13689b7e59afc9bf6e41e7e1b8109fc2e'
WORKER_DIR = Path(r'F:\TigerIQ\Worker')
REQUEST_PATH = WORKER_DIR / 'autoworker-deploy-request-v1.json'
RESULT_PATH = WORKER_DIR / 'autoworker-deploy-result-v1.json'
LOCK_PATH = WORKER_DIR / 'autoworker-deploy-v1.lock'
MAX_ATTEMPTS = 2
MAX_OUTPUT = 4000

def now():
    return datetime.now(timezone.utc).isoformat()

def write_json(path, obj):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)

def clipped(value):
    return str(value or '').replace('\x00', '')[-MAX_OUTPUT:]

def post_evidence(result):
    body = (
        'NV02 ZERO-TOUCH PC01 DEPLOY EVIDENCE\n\n'
        f"- candidate: V{VERSION}\n"
        f"- ok: `{str(bool(result.get('ok'))).lower()}`\n"
        f"- physical: `{result.get('physical','UNKNOWN')}`\n"
        f"- reload_mode: `{result.get('reload_mode','UNKNOWN')}`\n"
        f"- attempt: `{result.get('attempt',0)}/{MAX_ATTEMPTS}`\n"
        f"- installer_sha256: `{INSTALLER_SHA256}`\n"
        f"- state: `{result.get('state','UNKNOWN')}`\n"
        '\nNo MAIN/Production. NV04/NV05 remain inactive.'
    )
    try:
        p = subprocess.run(
            ['gh', 'issue', 'comment', ISSUE, '--repo', REPO, '--body', body],
            text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=60,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        return p.returncode == 0
    except Exception:
        return False

WORKER_DIR.mkdir(parents=True, exist_ok=True)
if not REQUEST_PATH.exists():
    raise SystemExit(0)

try:
    request = json.loads(REQUEST_PATH.read_text(encoding='utf-8'))
except Exception as e:
    write_json(RESULT_PATH, {'ok': False, 'state': 'REQUEST_INVALID', 'error': clipped(e), 'at': now()})
    raise SystemExit(21)

expected = {
    'schema': 1,
    'version': VERSION,
    'installer_url': INSTALLER_URL,
    'installer_sha256': INSTALLER_SHA256,
}
for key, value in expected.items():
    if request.get(key) != value:
        write_json(RESULT_PATH, {'ok': False, 'state': 'REQUEST_NOT_ALLOWLISTED', 'field': key, 'at': now()})
        raise SystemExit(22)
request_id = str(request.get('request_id', '')).strip()
if not request_id or len(request_id) > 160:
    write_json(RESULT_PATH, {'ok': False, 'state': 'REQUEST_ID_INVALID', 'at': now()})
    raise SystemExit(23)

try:
    prior = json.loads(RESULT_PATH.read_text(encoding='utf-8')) if RESULT_PATH.exists() else {}
except Exception:
    prior = {}
if prior.get('request_id') == request_id and prior.get('ok') is True:
    REQUEST_PATH.unlink(missing_ok=True)
    raise SystemExit(0)
attempt = int(prior.get('attempt', 0)) + 1 if prior.get('request_id') == request_id else 1
if attempt > MAX_ATTEMPTS:
    result = {'ok': False, 'state': 'RETRY_LIMIT_REACHED', 'request_id': request_id, 'attempt': attempt - 1, 'at': now()}
    write_json(RESULT_PATH, result)
    post_evidence(result)
    raise SystemExit(24)

try:
    fd = os.open(str(LOCK_PATH), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.close(fd)
except FileExistsError:
    raise SystemExit(0)

result = {
    'ok': False, 'state': 'STARTED', 'request_id': request_id, 'attempt': attempt,
    'version': VERSION, 'installer_sha256': INSTALLER_SHA256, 'at': now(),
}
try:
    with tempfile.TemporaryDirectory(prefix='TigerIQ_AW_ZT_') as td:
        installer = Path(td) / 'TigerIQ_AW_14.2.2_installer.ps1'
        with urllib.request.urlopen(INSTALLER_URL, timeout=45) as response:
            installer.write_bytes(response.read())
        actual = hashlib.sha256(installer.read_bytes()).hexdigest()
        if actual != INSTALLER_SHA256:
            raise RuntimeError('INSTALLER_HASH_MISMATCH actual=' + actual)

        env = os.environ.copy()
        env.pop('TIQ_PREFLIGHT_ONLY', None)
        started = time.monotonic()
        p = subprocess.run(
            ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(installer)],
            text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=210, env=env,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        result['elapsed_ms'] = int((time.monotonic() - started) * 1000)
        result['returncode'] = p.returncode
        result['stdout_tail'] = clipped(p.stdout)
        result['stderr_tail'] = clipped(p.stderr)

        log_path = Path(os.environ.get('LOCALAPPDATA', '')) / 'TigerIQ' / 'AutoWorker' / 'V14_2_2_INSTALL.log'
        log = log_path.read_text(encoding='utf-8', errors='replace') if log_path.exists() else ''
        result['log_tail'] = clipped(log)
        reload_mode = 'UNKNOWN'
        for line in log.splitlines():
            if 'RELOAD_MODE=' in line:
                reload_mode = line.split('RELOAD_MODE=', 1)[1].strip()
        result['reload_mode'] = reload_mode

        disk_ok = 'ON_DISK_STATIC_SELF_CHECK=PASS' in log
        chrome_confirmed = 'INSTALL_RESULT=TEST_CANDIDATE_INSTALLED_CHROME_VERSION_CONFIRMED' in log and reload_mode == 'CHROME_UI_VERSION_CONFIRMED'
        on_disk_only = 'INSTALL_RESULT=TEST_CANDIDATE_INSTALLED_ON_DISK_CHROME_NOT_STARTED_PHYSICAL_PENDING' in log
        result['physical'] = 'CONFIRMED' if chrome_confirmed else ('PENDING_CHROME_START' if on_disk_only else 'UNKNOWN')
        result['ok'] = p.returncode == 0 and disk_ok
        result['state'] = (
            'DEPLOYED_RELOAD_CONFIRMED' if result['ok'] and chrome_confirmed
            else 'DEPLOYED_ON_DISK_PHYSICAL_PENDING' if result['ok'] and on_disk_only
            else 'INSTALL_FAILED'
        )
        result['at'] = now()
except Exception as e:
    result.update({'ok': False, 'state': 'DEPLOY_EXCEPTION', 'error': clipped(f'{type(e).__name__}: {e}'), 'at': now()})
finally:
    try:
        LOCK_PATH.unlink(missing_ok=True)
    except Exception:
        pass

write_json(RESULT_PATH, result)
if result.get('ok'):
    REQUEST_PATH.unlink(missing_ok=True)
post_evidence(result)
raise SystemExit(0 if result.get('ok') else 25)
