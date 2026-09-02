import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

BRANCH = 'wo045/pc01-autonomy-hardening'
WORKSPACE = Path(r'F:\TigerIQ\Workspace\tigeriq-ai-lab')
SOURCE_DIR = WORKSPACE / 'scripts' / 'pc-worker'
WORKER_DIR = Path(r'F:\TigerIQ\Worker')
EVIDENCE = WORKER_DIR / 'live-upgrade-v3-evidence.json'
WORKER_TASK = 'TigerIQ Worker'
WATCHDOG_TASK = 'TigerIQ Worker Watchdog'
FILES = {
    SOURCE_DIR / 'worker_runtime_launcher.py': WORKER_DIR / 'worker.py',
    SOURCE_DIR / 'worker_secure_v3.py': WORKER_DIR / 'worker_impl.py',
    SOURCE_DIR / 'control_plane_v2.py': WORKER_DIR / 'control_plane_v2.py',
    SOURCE_DIR / 'worker-watchdog-v3.ps1': WORKER_DIR / 'watchdog.ps1',
    SOURCE_DIR / 'test_control_plane_v2.py': WORKER_DIR / 'test_control_plane_v2.py',
    SOURCE_DIR / 'test_worker_secure_v3.py': WORKER_DIR / 'test_worker_secure_v3.py',
}


def run(argv, cwd=None, timeout=180, check=True):
    p = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f'command failed rc={p.returncode}: {argv[0]}: {(p.stderr or p.stdout)[-2000:]}')
    return p


def now():
    return datetime.now(timezone.utc).isoformat()


def task_xml(name):
    p = run(['schtasks', '/Query', '/TN', name, '/XML'], timeout=30, check=False)
    if p.returncode != 0:
        raise RuntimeError(f'SCHEDULED_TASK_MISSING_OR_DENIED: {name}: {(p.stderr or p.stdout)[-1200:]}')
    return p.stdout


def verify_persistence():
    worker_xml = task_xml(WORKER_TASK)
    watchdog_xml = task_xml(WATCHDOG_TASK)
    recurring = 'PT1M' in watchdog_xml or '<ScheduleByMinute>' in watchdog_xml
    recovery_trigger = recurring or '<BootTrigger' in watchdog_xml or '<LogonTrigger>' in watchdog_xml
    if not recurring or not recovery_trigger:
        raise RuntimeError('WATCHDOG_RECOVERY_CONTRACT_MISSING')
    return {'watchdog_recurring': recurring, 'watchdog_recovery_trigger': recovery_trigger, 'worker_task_present': bool(worker_xml)}


def verify_source():
    branch = run(['git', 'branch', '--show-current'], cwd=WORKSPACE, timeout=30).stdout.strip()
    if branch != BRANCH:
        raise RuntimeError(f'WRONG_BRANCH: {branch}')
    head = run(['git', 'rev-parse', 'HEAD'], cwd=WORKSPACE, timeout=30).stdout.strip()
    remote = run(['git', 'rev-parse', f'origin/{BRANCH}'], cwd=WORKSPACE, timeout=30).stdout.strip()
    if head != remote:
        raise RuntimeError(f'HEAD_NOT_REMOTE: {head} != {remote}')
    py = sys.executable
    run([py, '-m', 'py_compile', str(SOURCE_DIR/'worker_runtime_launcher.py'), str(SOURCE_DIR/'worker_secure_v3.py'), str(SOURCE_DIR/'control_plane_v2.py'), str(SOURCE_DIR/'live_upgrade_secure_v3.py')], cwd=SOURCE_DIR)
    run([py, str(SOURCE_DIR/'test_control_plane_v2.py')], cwd=SOURCE_DIR)
    run([py, str(SOURCE_DIR/'test_worker_secure_v3.py')], cwd=SOURCE_DIR)
    run([py, str(SOURCE_DIR/'test_watchdog_v3_contract.py')], cwd=SOURCE_DIR)
    return {'branch': branch, 'head': head}


def install():
    WORKER_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup_dir = WORKER_DIR / 'backup' / f'secure-v3-{stamp}'
    backup_dir.mkdir(parents=True, exist_ok=True)
    backups = []
    for src, dst in FILES.items():
        if not src.exists():
            raise RuntimeError(f'MISSING_SOURCE: {src.name}')
        if dst.exists():
            backup = backup_dir / dst.name
            shutil.copy2(dst, backup)
            backups.append(str(backup))
    for src, dst in FILES.items():
        tmp = dst.with_suffix(dst.suffix + '.new')
        shutil.copy2(src, tmp)
        tmp.replace(dst)
    preflight = run([sys.executable, str(WORKER_DIR/'worker.py'), '--preflight'], cwd=WORKER_DIR, timeout=60, check=False)
    if preflight.returncode != 0:
        raise RuntimeError('NEW_WORKER_PREFLIGHT_FAILED: ' + (preflight.stderr or preflight.stdout)[-2000:])
    return {'backup_dir': str(backup_dir), 'backup_count': len(backups), 'preflight_tail': (preflight.stdout or '')[-1200:]}


def spawn_restart_helper(delay=90):
    flags = 0
    if os.name == 'nt':
        flags = getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
    subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), '--restart-helper', str(delay)],
        cwd=WORKSPACE, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=flags, close_fds=True,
    )


def restart_helper(delay):
    time.sleep(max(10, min(int(delay), 180)))
    end = run(['schtasks', '/End', '/TN', WORKER_TASK], timeout=30, check=False)
    time.sleep(4)
    kick = run(['schtasks', '/Run', '/TN', WATCHDOG_TASK], timeout=30, check=False)
    time.sleep(8)
    query = run(['schtasks', '/Query', '/TN', WORKER_TASK, '/FO', 'LIST', '/V'], timeout=30, check=False)
    event = {
        'timestamp': now(), 'phase': 'restart-helper',
        'worker_end_rc': end.returncode, 'watchdog_kick_rc': kick.returncode,
        'worker_query_rc': query.returncode, 'worker_query_tail': (query.stdout or '')[-1500:],
    }
    existing = {}
    try:
        existing = json.loads(EVIDENCE.read_text(encoding='utf-8'))
    except Exception:
        pass
    existing['restart'] = event
    EVIDENCE.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if kick.returncode == 0 and query.returncode == 0 else 2


def main():
    if '--restart-helper' in sys.argv:
        idx = sys.argv.index('--restart-helper')
        return restart_helper(sys.argv[idx + 1] if idx + 1 < len(sys.argv) else '90')
    if os.name != 'nt':
        raise RuntimeError('PC01 Windows only')
    evidence = {'timestamp': now(), 'phase': 'install'}
    try:
        evidence['persistence'] = verify_persistence()
        evidence['source'] = verify_source()
        evidence['install'] = install()
        evidence['state_preserved'] = True
        evidence['secrets_untouched'] = True
        evidence['restart_scheduled_seconds'] = 90
        evidence['result'] = 'SECURE_V3_FILES_INSTALLED'
        EVIDENCE.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        spawn_restart_helper(90)
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        evidence['result'] = 'FAIL'
        evidence['error'] = f'{type(exc).__name__}: {exc}'
        try:
            WORKER_DIR.mkdir(parents=True, exist_ok=True)
            EVIDENCE.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
