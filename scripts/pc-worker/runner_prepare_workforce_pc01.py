import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

EXPECTED_SOURCE_SHA = '731436be054e06cfdfe4b4d48e25507ab7adb35a'
PC01_WORKSPACE = Path(r'F:\TigerIQ\Workspace\tigeriq-ai-lab')
STATE_DIR = Path(r'F:\TigerIQ\State')
RUNTIME_DIR = Path(r'F:\TigerIQ\Runtime')
MANIFEST = STATE_DIR / 'workforce-runtime-manifest.json'
ENTRY_REL = Path('apps/workforce-controller/src/standalone.js')


def now():
    return datetime.now(timezone.utc).isoformat()


def run(argv, cwd=None, timeout=600, check=True, env=None):
    p = subprocess.run(
        argv,
        cwd=cwd,
        text=True,
        capture_output=True,
        encoding='utf-8',
        errors='replace',
        timeout=timeout,
        env=env,
    )
    if check and p.returncode != 0:
        raise RuntimeError(f'command failed rc={p.returncode}: {Path(str(argv[0])).name}: {(p.stderr or p.stdout)[-2500:]}')
    return p


def resolve_tool(name, candidates=()):
    found = shutil.which(name)
    if found:
        return str(Path(found).resolve())
    for candidate in candidates:
        p = Path(candidate)
        if p.exists():
            return str(p.resolve())
    raise RuntimeError(f'{name} unavailable')


def sha256_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verify_source(source):
    if os.name != 'nt':
        raise RuntimeError('PC01 Windows only')
    if not PC01_WORKSPACE.exists() or not (PC01_WORKSPACE / '.git').exists():
        raise RuntimeError('PC01 workspace layout missing')
    if not (source / '.git').exists():
        raise RuntimeError('staged workforce source is not a git checkout')
    git = resolve_tool('git', (r'C:\Program Files\Git\cmd\git.exe',))
    head = run([git, 'rev-parse', 'HEAD'], cwd=source, timeout=30).stdout.strip()
    if head != EXPECTED_SOURCE_SHA:
        raise RuntimeError(f'wrong workforce source SHA: {head}')
    required = [source / 'package.json', source / 'package-lock.json', source / 'apps' / 'workforce-controller' / 'src' / 'standalone.ts']
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise RuntimeError('required workforce source missing: ' + ', '.join(missing))
    return head


def build_source(source):
    node = resolve_tool('node', (r'C:\Program Files\nodejs\node.exe',))
    npm = resolve_tool('npm.cmd', (r'C:\Program Files\nodejs\npm.cmd',))
    env = os.environ.copy()
    env['NODE_ENV'] = 'development'
    env['npm_config_audit'] = 'false'
    env['npm_config_fund'] = 'false'
    install = run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=source, timeout=600, env=env)
    build = run([npm, 'run', 'build'], cwd=source, timeout=600, env=env)
    dist = source / 'dist'
    entry = dist / ENTRY_REL
    if not entry.exists():
        raise RuntimeError(f'compiled Workforce Controller entry missing: {entry}')
    node_version = run([node, '--version'], cwd=source, timeout=20).stdout.strip()
    npm_version = run([npm, '--version'], cwd=source, timeout=20).stdout.strip()
    return {
        'dist': dist,
        'entry': entry,
        'entry_sha256': sha256_file(entry),
        'node_version': node_version,
        'npm_version': npm_version,
        'npm_ci_rc': install.returncode,
        'build_rc': build.returncode,
    }


def install_dist(source_dist):
    dest = PC01_WORKSPACE / 'dist'
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    backup_root = RUNTIME_DIR / 'backups'
    backup_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    staging = PC01_WORKSPACE / f'.workforce-dist.new-{stamp}'
    backup = backup_root / f'workforce-dist-{stamp}'
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(source_dist, staging)
    moved_old = False
    try:
        if dest.exists():
            shutil.move(str(dest), str(backup))
            moved_old = True
        staging.replace(dest)
    except Exception:
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        if moved_old and backup.exists():
            shutil.move(str(backup), str(dest))
        raise
    return {'destination': str(dest), 'backup': str(backup) if moved_old else None}


def main():
    evidence = {'timestamp': now(), 'expected_source_sha': EXPECTED_SOURCE_SHA}
    try:
        if len(sys.argv) != 2:
            raise RuntimeError('usage: runner_prepare_workforce_pc01.py <staged-source-dir>')
        source = Path(sys.argv[1]).resolve()
        evidence['source_sha'] = verify_source(source)
        built = build_source(source)
        evidence['build'] = {k: v for k, v in built.items() if k not in {'dist', 'entry'}}
        evidence['install'] = install_dist(built['dist'])
        installed_entry = PC01_WORKSPACE / 'dist' / ENTRY_REL
        if not installed_entry.exists():
            raise RuntimeError('installed Workforce Controller entry missing')
        installed_hash = sha256_file(installed_entry)
        if installed_hash != built['entry_sha256']:
            raise RuntimeError('installed Workforce Controller entry hash mismatch')
        evidence['installed_entry_sha256'] = installed_hash
        evidence['secrets_touched'] = False
        evidence['source_workspace_mutated'] = False
        evidence['result'] = 'PC01_WORKFORCE_RUNTIME_PREPARED'
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
        print('PC01_WORKFORCE_RUNTIME_PREPARED')
        return 0
    except Exception as exc:
        evidence['result'] = 'FAIL'
        evidence['error'] = f'{type(exc).__name__}: {exc}'
        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            MANIFEST.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception:
            pass
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
