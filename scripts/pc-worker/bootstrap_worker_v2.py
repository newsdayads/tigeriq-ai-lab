import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

WORKSPACE = Path(r'F:\TigerIQ\Workspace\tigeriq-ai-lab')
SOURCE_DIR = WORKSPACE / 'scripts' / 'pc-worker'
WORKER_DIR = Path(r'F:\TigerIQ\Worker')
BRANCH = 'wo045/pc01-autonomy-hardening'
WORKER_TASK = 'TigerIQ Worker'
WATCHDOG_TASK = 'TigerIQ Worker Watchdog'

PY_FILES = {
    SOURCE_DIR / 'worker_runtime_launcher.py': WORKER_DIR / 'worker.py',
    SOURCE_DIR / 'worker_secure_v3.py': WORKER_DIR / 'worker_impl.py',
    SOURCE_DIR / 'control_plane_v2.py': WORKER_DIR / 'control_plane_v2.py',
    SOURCE_DIR / 'test_control_plane_v2.py': WORKER_DIR / 'test_control_plane_v2.py',
    SOURCE_DIR / 'test_worker_secure_v3.py': WORKER_DIR / 'test_worker_secure_v3.py',
}
COPY_FILES = {
    **PY_FILES,
    SOURCE_DIR / 'worker-watchdog-v3.ps1': WORKER_DIR / 'watchdog.ps1',
}


def run(argv, cwd=None, timeout=180, check=True):
    p = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f"command failed rc={p.returncode}: {' '.join(argv)}\n{p.stderr or p.stdout}")
    return p


def task_xml(name):
    result = run(['schtasks', '/Query', '/TN', name, '/XML'], timeout=30, check=False)
    if result.returncode != 0:
        raise RuntimeError(f'REAL_BLOCKER_SCHEDULED_TASK_MISSING: {name}: {result.stderr or result.stdout}')
    return result.stdout


def persistence_contract(worker_xml, watchdog_xml):
    worker_start = '<BootTrigger' in worker_xml or '<LogonTrigger' in worker_xml
    watchdog_recurring = ('PT1M' in watchdog_xml) or ('<ScheduleByMinute>' in watchdog_xml)
    watchdog_start = '<BootTrigger' in watchdog_xml or '<LogonTrigger' in watchdog_xml or watchdog_recurring
    if not worker_start and not watchdog_start:
        raise RuntimeError('REAL_BLOCKER_STARTUP_TRIGGER_MISSING: neither Worker nor Watchdog has a boot/logon/recurring recovery trigger')
    if not watchdog_recurring:
        raise RuntimeError('REAL_BLOCKER_WATCHDOG_RECURRENCE_MISSING: Watchdog is not configured for one-minute recovery')
    return {'worker_start_trigger': worker_start, 'watchdog_recurring': watchdog_recurring, 'watchdog_start_or_recovery': watchdog_start}


def main():
    if os.name != 'nt':
        raise RuntimeError('PC01 bootstrap must run on Windows')
    if not (WORKSPACE / '.git').exists():
        raise RuntimeError('workspace git repository missing')

    branch = run(['git', 'branch', '--show-current'], cwd=WORKSPACE, timeout=30).stdout.strip()
    if branch != BRANCH:
        raise RuntimeError(f'wrong branch: {branch}; expected {BRANCH}')
    head = run(['git', 'rev-parse', 'HEAD'], cwd=WORKSPACE, timeout=30).stdout.strip()
    remote = run(['git', 'rev-parse', f'origin/{BRANCH}'], cwd=WORKSPACE, timeout=30).stdout.strip()
    if head != remote:
        raise RuntimeError(f'HEAD {head} does not match remote {remote}')

    for src in COPY_FILES:
        if not src.exists():
            raise RuntimeError(f'missing source: {src}')
    run([sys.executable, '-m', 'py_compile', *[str(x) for x in PY_FILES]], cwd=WORKSPACE)
    run([sys.executable, str(SOURCE_DIR / 'test_control_plane_v2.py')], cwd=SOURCE_DIR)
    run([sys.executable, str(SOURCE_DIR / 'test_worker_secure_v3.py')], cwd=SOURCE_DIR)

    ps_parse = run([
        'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        "$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile('" + str(SOURCE_DIR / 'worker-watchdog-v3.ps1') + "',[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{$_.Message};exit 1}",
    ], cwd=WORKSPACE, timeout=30, check=False)
    if ps_parse.returncode != 0:
        raise RuntimeError('watchdog PowerShell parse failed: ' + (ps_parse.stderr or ps_parse.stdout))

    # Do not silently change task principals/credentials. Existing tasks are part of the current PC01 trust boundary.
    worker_xml = task_xml(WORKER_TASK)
    watchdog_xml = task_xml(WATCHDOG_TASK)
    persistence = persistence_contract(worker_xml, watchdog_xml)

    WORKER_DIR.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time())
    for dst in COPY_FILES.values():
        if dst.exists():
            backup = WORKER_DIR / f'{dst.name}.bak-{stamp}'
            shutil.copy2(dst, backup)
            print(f'backup={backup}')

    for src, dst in COPY_FILES.items():
        tmp = dst.with_suffix(dst.suffix + '.new')
        shutil.copy2(src, tmp)
        tmp.replace(dst)

    preflight = run([sys.executable, str(WORKER_DIR / 'worker.py'), '--preflight'], cwd=WORKER_DIR, timeout=60, check=False)
    print('runtime_preflight=' + (preflight.stdout or preflight.stderr).strip())
    if preflight.returncode != 0:
        raise RuntimeError(f'worker runtime preflight failed rc={preflight.returncode}: {preflight.stderr or preflight.stdout}')

    run(['schtasks', '/End', '/TN', WORKER_TASK], timeout=30, check=False)
    time.sleep(2)
    start = run(['schtasks', '/Run', '/TN', WORKER_TASK], timeout=30, check=False)
    if start.returncode != 0:
        raise RuntimeError(f'worker scheduled task restart failed: {start.stderr or start.stdout}')
    time.sleep(5)

    watchdog_smoke = run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(WORKER_DIR / 'watchdog.ps1')], cwd=WORKER_DIR, timeout=45, check=False)
    if watchdog_smoke.returncode != 0:
        raise RuntimeError(f'watchdog smoke failed rc={watchdog_smoke.returncode}: {watchdog_smoke.stderr or watchdog_smoke.stdout}')

    query_worker = run(['schtasks', '/Query', '/TN', WORKER_TASK, '/FO', 'LIST', '/V'], timeout=30)
    query_watchdog = run(['schtasks', '/Query', '/TN', WATCHDOG_TASK, '/FO', 'LIST', '/V'], timeout=30)

    print('PC01_WORKER_SECURE_V3_BOOTSTRAP_PASS')
    print(f'branch={branch}')
    print(f'head={head}')
    print('persistence=' + str(persistence))
    print(query_worker.stdout[-2500:])
    print(query_watchdog.stdout[-2500:])


if __name__ == '__main__':
    main()
