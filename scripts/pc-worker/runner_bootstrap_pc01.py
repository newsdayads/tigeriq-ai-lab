import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = 'newsdayads/tigeriq-ai-lab'
CANARY_ISSUE = 58
SOURCE_DIR = Path(__file__).resolve().parent
WORKER_DIR = Path(r'F:\TigerIQ\Worker')
PC01_WORKSPACE = Path(r'F:\TigerIQ\Workspace\tigeriq-ai-lab')
WORKER_TASK = 'TigerIQ Worker'
WATCHDOG_TASK = 'TigerIQ Worker Watchdog'
EXPECTED_FILES = {
    SOURCE_DIR / 'worker_runtime_launcher.py': WORKER_DIR / 'worker.py',
    SOURCE_DIR / 'worker_secure_v3.py': WORKER_DIR / 'worker_impl.py',
    SOURCE_DIR / 'control_plane_v2.py': WORKER_DIR / 'control_plane_v2.py',
    SOURCE_DIR / 'test_control_plane_v2.py': WORKER_DIR / 'test_control_plane_v2.py',
    SOURCE_DIR / 'test_worker_secure_v3.py': WORKER_DIR / 'test_worker_secure_v3.py',
    SOURCE_DIR / 'worker-watchdog-v3.ps1': WORKER_DIR / 'watchdog.ps1',
}
EVIDENCE_PATH = WORKER_DIR / 'bootstrap-evidence-v3.json'


def now():
    return datetime.now(timezone.utc).isoformat()


def run(argv, cwd=None, timeout=180, check=True, env=None):
    p = subprocess.run(
        argv, cwd=cwd, text=True, capture_output=True,
        encoding='utf-8', errors='replace', timeout=timeout, env=env,
    )
    if check and p.returncode != 0:
        raise RuntimeError(f"command failed rc={p.returncode}: {' '.join(str(x) for x in argv)}\n{(p.stderr or p.stdout)[-3000:]}")
    return p


def clean_env():
    env = os.environ.copy()
    env.pop('GH_TOKEN', None)
    env.pop('GITHUB_TOKEN', None)
    return env


def task_xml(name):
    result = run(['schtasks', '/Query', '/TN', name, '/XML'], timeout=30, check=False)
    if result.returncode != 0:
        raise RuntimeError(f'REAL_BLOCKER_SCHEDULED_TASK_MISSING_OR_DENIED: {name}: {(result.stderr or result.stdout)[-1500:]}')
    return result.stdout


def persistence_contract(worker_xml, watchdog_xml):
    worker_start = '<BootTrigger' in worker_xml or '<LogonTrigger' in worker_xml
    watchdog_recurring = ('PT1M' in watchdog_xml) or ('<ScheduleByMinute>' in watchdog_xml)
    watchdog_start = '<BootTrigger' in watchdog_xml or '<LogonTrigger' in watchdog_xml or watchdog_recurring
    if not worker_start and not watchdog_start:
        raise RuntimeError('REAL_BLOCKER_STARTUP_TRIGGER_MISSING')
    if not watchdog_recurring:
        raise RuntimeError('REAL_BLOCKER_WATCHDOG_RECURRENCE_MISSING')
    return {
        'worker_start_trigger': worker_start,
        'watchdog_recurring': watchdog_recurring,
        'watchdog_start_or_recovery': watchdog_start,
    }


def run_source_tests():
    py = sys.executable
    py_files = [
        SOURCE_DIR / 'worker_runtime_launcher.py',
        SOURCE_DIR / 'worker_secure_v3.py',
        SOURCE_DIR / 'control_plane_v2.py',
        SOURCE_DIR / 'test_control_plane_v2.py',
        SOURCE_DIR / 'test_worker_secure_v3.py',
        SOURCE_DIR / 'test_watchdog_v3_contract.py',
    ]
    run([py, '-m', 'py_compile', *[str(x) for x in py_files]], cwd=SOURCE_DIR)
    run([py, str(SOURCE_DIR / 'test_control_plane_v2.py')], cwd=SOURCE_DIR)
    run([py, str(SOURCE_DIR / 'test_worker_secure_v3.py')], cwd=SOURCE_DIR)
    run([py, str(SOURCE_DIR / 'test_watchdog_v3_contract.py')], cwd=SOURCE_DIR)
    parse = run([
        'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile('" + str(SOURCE_DIR / 'worker-watchdog-v3.ps1') + "',[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{$_.Message};exit 1}",
    ], cwd=SOURCE_DIR, timeout=30, check=False)
    if parse.returncode != 0:
        raise RuntimeError('watchdog PowerShell parse failed: ' + (parse.stderr or parse.stdout)[-1500:])


def backup_and_install():
    WORKER_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backups = {}
    for src, dst in EXPECTED_FILES.items():
        if not src.exists():
            raise RuntimeError(f'missing source file: {src}')
        if dst.exists():
            backup = WORKER_DIR / f'{dst.name}.bak-{stamp}'
            shutil.copy2(dst, backup)
            backups[str(dst)] = str(backup)
    try:
        for src, dst in EXPECTED_FILES.items():
            tmp = dst.with_suffix(dst.suffix + '.new')
            shutil.copy2(src, tmp)
            tmp.replace(dst)
        return backups
    except Exception:
        for dst_name, backup_name in backups.items():
            dst = Path(dst_name)
            backup = Path(backup_name)
            if backup.exists():
                shutil.copy2(backup, dst)
        raise


def worker_preflight():
    result = run([sys.executable, str(WORKER_DIR / 'worker.py'), '--preflight'], cwd=WORKER_DIR, timeout=60, check=False, env=clean_env())
    if result.returncode != 0:
        raise RuntimeError(f'REAL_BLOCKER_WORKER_PREFLIGHT: {(result.stderr or result.stdout)[-2500:]}')
    return (result.stdout or '').strip()[-2500:]


def restart_worker():
    run(['schtasks', '/End', '/TN', WORKER_TASK], timeout=30, check=False)
    time.sleep(2)
    start = run(['schtasks', '/Run', '/TN', WORKER_TASK], timeout=30, check=False)
    if start.returncode != 0:
        raise RuntimeError(f'REAL_BLOCKER_WORKER_TASK_START: {(start.stderr or start.stdout)[-1500:]}')
    time.sleep(5)


def gh_path():
    candidates = [
        shutil.which('gh'),
        r'C:\Program Files\GitHub CLI\gh.exe',
        r'C:\Program Files (x86)\GitHub CLI\gh.exe',
    ]
    for value in candidates:
        if value and Path(value).exists():
            return str(Path(value).resolve())
    raise RuntimeError('REAL_BLOCKER_GH_MISSING')


def canary_comments():
    gh = gh_path()
    result = run([gh, 'api', f'repos/{REPO}/issues/{CANARY_ISSUE}/comments', '--paginate'], timeout=60, env=clean_env())
    return json.loads(result.stdout or '[]')


def wait_for_canary(timeout_seconds=150):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        comments = canary_comments()
        bodies = [str(row.get('body') or '') for row in comments]
        claim_count = sum('TIGERIQ_PC01_CLAIMED' in body for body in bodies)
        done_count = sum('TIGERIQ_PC01_DONE' in body for body in bodies)
        secure_done = any('TIGERIQ_PC01_DONE' in body and 'secure-v3-command' in body for body in bodies)
        failed = [body for body in bodies if 'TIGERIQ_PC01_FAILED' in body]
        if secure_done:
            return {'claim_count': claim_count, 'done_count': done_count, 'secure_v3': True}
        if failed:
            raise RuntimeError('REAL_BLOCKER_CANARY_FAILED: issue #58 contains TIGERIQ_PC01_FAILED')
        time.sleep(5)
    raise RuntimeError('REAL_BLOCKER_CANARY_TIMEOUT: issue #58 was not consumed by secure-v3 worker')


def tail_runtime_classification():
    path = WORKER_DIR / 'worker-runtime.log'
    if not path.exists():
        return ['worker-runtime.log missing']
    lines = path.read_text(encoding='utf-8', errors='replace').splitlines()[-120:]
    safe = []
    for line in lines:
        lower = line.lower()
        if any(marker in lower for marker in ('authorization:', 'cookie:', 'token=', 'password=', 'secret=')):
            continue
        if 'worker error' in lower or 'worker_launcher_start' in lower or 'tigeriq github queue worker online' in lower:
            safe.append(line[-1000:])
    return safe[-12:]


def watchdog_recovery_smoke():
    audit = WORKER_DIR / 'watchdog-v3.jsonl'
    before = audit.stat().st_size if audit.exists() else 0
    run(['schtasks', '/End', '/TN', WORKER_TASK], timeout=30, check=False)
    time.sleep(3)
    wd = run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(WORKER_DIR / 'watchdog.ps1')], cwd=WORKER_DIR, timeout=45, check=False)
    if wd.returncode != 0:
        raise RuntimeError(f'REAL_BLOCKER_WATCHDOG_SMOKE: {(wd.stderr or wd.stdout)[-1500:]}')
    time.sleep(5)
    if not audit.exists():
        raise RuntimeError('REAL_BLOCKER_WATCHDOG_EVIDENCE_MISSING')
    data = audit.read_bytes()[before:].decode('utf-8', errors='replace').splitlines()
    events = []
    for line in data:
        try:
            obj = json.loads(line.lstrip('\ufeff'))
            events.append(obj.get('event'))
        except Exception:
            pass
    if 'worker_recovered' not in events:
        raise RuntimeError(f'REAL_BLOCKER_WATCHDOG_NOT_RECOVERED: events={events[-10:]}')
    return {'events': events[-10:], 'recovered': True}


def main():
    evidence = {
        'timestamp': now(),
        'source_sha': os.getenv('GITHUB_SHA', ''),
        'runner_name': os.getenv('RUNNER_NAME', ''),
        'runner_os': os.getenv('RUNNER_OS', ''),
    }
    try:
        if os.name != 'nt':
            raise RuntimeError('NOT_PC01_WINDOWS_RUNNER')
        if not PC01_WORKSPACE.exists() or not WORKER_DIR.parent.exists():
            raise RuntimeError('NOT_PC01_LAYOUT: expected F:\\TigerIQ layout is absent')
        worker_xml = task_xml(WORKER_TASK)
        watchdog_xml = task_xml(WATCHDOG_TASK)
        evidence['persistence'] = persistence_contract(worker_xml, watchdog_xml)
        run_source_tests()
        evidence['source_tests'] = 'PASS'
        evidence['backups'] = backup_and_install()
        evidence['preflight'] = worker_preflight()
        restart_worker()
        try:
            evidence['canary'] = wait_for_canary()
        except Exception:
            evidence['runtime_classification'] = tail_runtime_classification()
            raise
        evidence['watchdog'] = watchdog_recovery_smoke()
        evidence['result'] = 'PC01_SELFHOSTED_BOOTSTRAP_PASS'
        EVIDENCE_PATH.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
        print('PC01_AUTONOMOUS_INGRESS_PASS')
        print('PC01_WATCHDOG_RECOVERY_PASS')
        return 0
    except Exception as exc:
        evidence['result'] = 'FAIL'
        evidence['error'] = f'{type(exc).__name__}: {exc}'
        evidence['runtime_classification'] = tail_runtime_classification()
        try:
            WORKER_DIR.mkdir(parents=True, exist_ok=True)
            EVIDENCE_PATH.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
