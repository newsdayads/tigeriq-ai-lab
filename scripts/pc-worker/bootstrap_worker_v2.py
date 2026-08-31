import shutil
import subprocess
import sys
import time
from pathlib import Path

WORKSPACE = Path(r'F:\TigerIQ\Workspace\tigeriq-ai-lab')
SOURCE_DIR = WORKSPACE / 'scripts' / 'pc-worker'
WORKER_DIR = Path(r'F:\TigerIQ\Worker')
BRANCH = 'wo045/pc01-autonomy-hardening'
FILES = {
    SOURCE_DIR / 'worker_runtime_launcher.py': WORKER_DIR / 'worker.py',
    SOURCE_DIR / 'worker_secure_v3.py': WORKER_DIR / 'worker_impl.py',
    SOURCE_DIR / 'control_plane_v2.py': WORKER_DIR / 'control_plane_v2.py',
    SOURCE_DIR / 'test_control_plane_v2.py': WORKER_DIR / 'test_control_plane_v2.py',
    SOURCE_DIR / 'test_worker_secure_v3.py': WORKER_DIR / 'test_worker_secure_v3.py',
}


def run(argv, cwd=None, timeout=180, check=True):
    p = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f"command failed rc={p.returncode}: {' '.join(argv)}\n{p.stderr or p.stdout}")
    return p


def main():
    if not (WORKSPACE / '.git').exists():
        raise RuntimeError('workspace git repository missing')
    branch = run(['git', 'branch', '--show-current'], cwd=WORKSPACE, timeout=30).stdout.strip()
    if branch != BRANCH:
        raise RuntimeError(f'wrong branch: {branch}; expected {BRANCH}')
    head = run(['git', 'rev-parse', 'HEAD'], cwd=WORKSPACE, timeout=30).stdout.strip()
    remote = run(['git', 'rev-parse', f'origin/{BRANCH}'], cwd=WORKSPACE, timeout=30).stdout.strip()
    if head != remote:
        raise RuntimeError(f'HEAD {head} does not match remote {remote}')

    for src in FILES:
        if not src.exists():
            raise RuntimeError(f'missing source: {src}')
    run([sys.executable, '-m', 'py_compile', *[str(x) for x in FILES]], cwd=WORKSPACE)
    run([sys.executable, str(SOURCE_DIR / 'test_control_plane_v2.py')], cwd=SOURCE_DIR)
    run([sys.executable, str(SOURCE_DIR / 'test_worker_secure_v3.py')], cwd=SOURCE_DIR)

    WORKER_DIR.mkdir(parents=True, exist_ok=True)
    for existing in ('worker.py', 'worker_impl.py', 'control_plane_v2.py'):
        path = WORKER_DIR / existing
        if path.exists():
            backup = WORKER_DIR / f'{existing}.bak-{int(time.time())}'
            shutil.copy2(path, backup)
            print(f'backup={backup}')

    for src, dst in FILES.items():
        tmp = dst.with_suffix(dst.suffix + '.new')
        shutil.copy2(src, tmp)
        tmp.replace(dst)

    preflight = run([sys.executable, str(WORKER_DIR / 'worker.py'), '--preflight'], cwd=WORKER_DIR, timeout=60, check=False)
    print('runtime_preflight=' + (preflight.stdout or preflight.stderr).strip())
    if preflight.returncode != 0:
        raise RuntimeError(f'worker runtime preflight failed rc={preflight.returncode}: {preflight.stderr or preflight.stdout}')

    run(['schtasks', '/End', '/TN', 'TigerIQ Worker'], timeout=30, check=False)
    time.sleep(2)
    start = run(['schtasks', '/Run', '/TN', 'TigerIQ Worker'], timeout=30, check=False)
    if start.returncode != 0:
        raise RuntimeError(f'worker scheduled task restart failed: {start.stderr or start.stdout}')
    time.sleep(5)
    query = run(['schtasks', '/Query', '/TN', 'TigerIQ Worker', '/FO', 'LIST', '/V'], timeout=30)
    print('PC01_WORKER_SECURE_V3_BOOTSTRAP_PASS')
    print(f'branch={branch}')
    print(f'head={head}')
    print(query.stdout[-4000:])


if __name__ == '__main__':
    main()
