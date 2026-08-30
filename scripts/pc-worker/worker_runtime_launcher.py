import json
import os
import runpy
import shutil
import subprocess
import sys
import time
from pathlib import Path

WORKER_DIR = Path(r'F:\TigerIQ\Worker')
IMPL = WORKER_DIR / 'worker_impl.py'
LOG_PATH = WORKER_DIR / 'worker-runtime.log'
REPO = os.getenv('TIGERIQ_REPO', 'newsdayads/tigeriq-ai-lab')

TOOL_CANDIDATES = {
    'gh': [
        Path(r'C:\Program Files\GitHub CLI\gh.exe'),
        Path(r'C:\Program Files (x86)\GitHub CLI\gh.exe'),
    ],
    'git': [
        Path(r'C:\Program Files\Git\cmd\git.exe'),
        Path(r'C:\Program Files\Git\bin\git.exe'),
    ],
    'ollama': [
        Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'Ollama' / 'ollama.exe',
    ],
}


def resolve_tool(name):
    found = shutil.which(name)
    if found:
        return Path(found).resolve()
    for candidate in TOOL_CANDIDATES.get(name, []):
        if candidate and candidate.exists():
            return candidate.resolve()
    return None


def prepare_environment():
    resolved = {}
    prepend = []
    for name in ('gh', 'git', 'ollama'):
        path = resolve_tool(name)
        resolved[name] = str(path) if path else None
        if path and str(path.parent) not in prepend:
            prepend.append(str(path.parent))
    current = os.environ.get('PATH', '')
    os.environ['PATH'] = os.pathsep.join(prepend + ([current] if current else []))
    return resolved


def run(argv, timeout=30):
    p = subprocess.run(argv, text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout)
    return {
        'returncode': p.returncode,
        'stdout': (p.stdout or '').strip()[-2000:],
        'stderr': (p.stderr or '').strip()[-2000:],
    }


def preflight():
    resolved = prepare_environment()
    result = {
        'timestamp': time.time(),
        'worker_dir': str(WORKER_DIR),
        'implementation_exists': IMPL.exists(),
        'tools': resolved,
        'repo_access': False,
    }
    gh_path = resolved.get('gh')
    if not gh_path:
        result['error'] = 'gh executable unavailable in scheduled-task runtime'
        print(json.dumps(result, ensure_ascii=False))
        return 2
    probe = run([gh_path, 'api', f'repos/{REPO}', '--jq', '.full_name'], timeout=30)
    result['gh_probe'] = probe
    result['repo_access'] = probe['returncode'] == 0 and probe['stdout'].strip() == REPO
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['implementation_exists'] and result['repo_access'] else 3


def main():
    WORKER_DIR.mkdir(parents=True, exist_ok=True)
    if '--preflight' in sys.argv:
        raise SystemExit(preflight())
    resolved = prepare_environment()
    with LOG_PATH.open('a', encoding='utf-8', buffering=1) as log:
        sys.stdout = log
        sys.stderr = log
        print(json.dumps({'event': 'worker_launcher_start', 'time': time.time(), 'tools': resolved}, ensure_ascii=False), flush=True)
        if not IMPL.exists():
            raise RuntimeError(f'worker implementation missing: {IMPL}')
        runpy.run_path(str(IMPL), run_name='__main__')


if __name__ == '__main__':
    main()
