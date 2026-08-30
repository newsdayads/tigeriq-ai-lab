import json
import os
import platform
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

WORKSPACE = Path(os.getenv('TIGERIQ_WORKSPACE', r'F:\TigerIQ\Workspace\tigeriq-ai-lab')).resolve()
STATE_PATH = Path(os.getenv('TIGERIQ_CONTROL_STATE', r'F:\TigerIQ\Worker\control-plane-state.json'))
AUDIT_PATH = Path(os.getenv('TIGERIQ_CONTROL_AUDIT', r'F:\TigerIQ\Worker\control-plane-audit.jsonl'))
LEASE_SECONDS = int(os.getenv('TIGERIQ_LEASE_SECONDS', '300'))
COMMAND_MARKER = 'TIGERIQ_COMMAND_V1'
ALLOWED_TASKS = {'TigerIQ Worker', 'TigerIQ Worker Watchdog', 'TigerIQ Command Center'}
REDACT_TOKENS = ('authorization:', 'cookie:', 'api_key=', 'api-key=', 'token=', 'password=', 'secret=')


def now_dt():
    return datetime.now(timezone.utc)


def now():
    return now_dt().isoformat()


def redact(value):
    text = '' if value is None else str(value)
    lowered = text.lower()
    if any(x in lowered for x in REDACT_TOKENS):
        return '[REDACTED]'
    return text[-12000:]


def load_state():
    try:
        state = json.loads(STATE_PATH.read_text(encoding='utf-8'))
        if not isinstance(state, dict):
            raise ValueError('state must be object')
        state.setdefault('completed', {})
        state.setdefault('leases', {})
        return state
    except Exception:
        return {'completed': {}, 'leases': {}}


def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(STATE_PATH)


def append_audit(event):
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    safe = {k: redact(v) if isinstance(v, str) else v for k, v in event.items()}
    with AUDIT_PATH.open('a', encoding='utf-8') as f:
        f.write(json.dumps(safe, ensure_ascii=False) + '\n')


def acquire_lease(state, issue_number, idempotency_key):
    key = str(issue_number)
    completed = state['completed'].get(idempotency_key)
    if completed:
        return {'status': 'completed', 'result': completed}
    lease = state['leases'].get(key)
    if lease:
        expires = datetime.fromisoformat(lease['expires_at'])
        if expires > now_dt() and lease.get('idempotency_key') != idempotency_key:
            return {'status': 'busy', 'lease': lease}
    lease = {
        'issue_number': issue_number,
        'idempotency_key': idempotency_key,
        'claimed_at': now(),
        'heartbeat_at': now(),
        'expires_at': (now_dt() + timedelta(seconds=LEASE_SECONDS)).isoformat(),
    }
    state['leases'][key] = lease
    save_state(state)
    append_audit({'event': 'lease_acquired', **lease})
    return {'status': 'acquired', 'lease': lease}


def heartbeat(state, issue_number):
    lease = state['leases'].get(str(issue_number))
    if not lease:
        return None
    lease['heartbeat_at'] = now()
    lease['expires_at'] = (now_dt() + timedelta(seconds=LEASE_SECONDS)).isoformat()
    save_state(state)
    append_audit({'event': 'heartbeat', **lease})
    return lease


def finish(state, issue_number, idempotency_key, result):
    state['completed'][idempotency_key] = result
    state['leases'].pop(str(issue_number), None)
    save_state(state)
    append_audit({'event': 'completed', 'issue_number': issue_number, 'idempotency_key': idempotency_key, 'result': result})


def _run(argv, timeout=60, cwd=None):
    p = subprocess.run(argv, cwd=cwd or WORKSPACE, text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout)
    return {'returncode': p.returncode, 'stdout': redact(p.stdout), 'stderr': redact(p.stderr)}


def _validate_repo_path(path):
    p = (WORKSPACE / path).resolve() if not Path(path).is_absolute() else Path(path).resolve()
    if p != WORKSPACE and WORKSPACE not in p.parents:
        raise ValueError('path outside approved workspace')
    return p


def execute_command(command):
    if not isinstance(command, dict):
        raise ValueError('command must be object')
    action = command.get('action')
    args = command.get('args') or {}
    if not isinstance(args, dict):
        raise ValueError('args must be object')

    if action == 'system.status':
        return {
            'ok': True,
            'action': action,
            'hostname': platform.node(),
            'platform': platform.platform(),
            'python': platform.python_version(),
            'workspace_exists': WORKSPACE.exists(),
        }

    if action == 'ollama.status':
        result = _run(['ollama', 'list'], timeout=30)
        return {'ok': result['returncode'] == 0, 'action': action, 'result': result}

    if action == 'ollama.unload':
        model = str(args.get('model', '')).strip()
        if not model or any(x in model for x in (' ', ';', '&', '|')):
            raise ValueError('invalid model name')
        result = _run(['ollama', 'stop', model], timeout=30)
        return {'ok': result['returncode'] == 0, 'action': action, 'result': result}

    if action in {'tigeriq.task.status', 'tigeriq.task.start', 'tigeriq.task.stop'}:
        task = str(args.get('task', '')).strip()
        if task not in ALLOWED_TASKS:
            raise ValueError('task not allowlisted')
        if action.endswith('.status'):
            argv = ['schtasks', '/Query', '/TN', task, '/FO', 'LIST', '/V']
        elif action.endswith('.start'):
            argv = ['schtasks', '/Run', '/TN', task]
        else:
            argv = ['schtasks', '/End', '/TN', task]
        result = _run(argv, timeout=30)
        return {'ok': result['returncode'] == 0, 'action': action, 'task': task, 'result': result}

    if action == 'repo.status':
        result = _run(['git', 'status', '--short', '--branch'], timeout=30)
        return {'ok': result['returncode'] == 0, 'action': action, 'result': result}

    if action == 'repo.fetch':
        branch = str(args.get('branch', '')).strip()
        approved = {'wo011/pc01-remote-exec', 'wo010/command-center-web-control'}
        if branch not in approved:
            raise ValueError('branch not allowlisted')
        result = _run(['git', 'fetch', 'origin', branch, '--prune'], timeout=120)
        return {'ok': result['returncode'] == 0, 'action': action, 'branch': branch, 'result': result}

    if action == 'repo.test':
        script = str(args.get('script', '')).strip()
        approved = {
            'python -m py_compile scripts/pc-worker/worker-github-queue.py',
            'python -m py_compile scripts/pc-worker/control_plane_v2.py',
            'python scripts/pc-worker/test_control_plane_v2.py',
        }
        if script not in approved:
            raise ValueError('test command not allowlisted')
        result = _run(script.split(' '), timeout=180)
        return {'ok': result['returncode'] == 0, 'action': action, 'script': script, 'result': result}

    raise ValueError(f'unsupported action: {action}')


def parse_command_body(body):
    if COMMAND_MARKER not in body:
        return None
    tail = body.split(COMMAND_MARKER, 1)[1].strip()
    if tail.startswith('```'):
        tail = tail.split('\n', 1)[1] if '\n' in tail else ''
        tail = tail.rsplit('```', 1)[0].strip()
    obj = json.loads(tail)
    if not isinstance(obj, dict):
        raise ValueError('command payload must be object')
    if not obj.get('idempotency_key'):
        raise ValueError('idempotency_key required')
    if not obj.get('action'):
        raise ValueError('action required')
    return obj


def execute_once(issue_number, command):
    state = load_state()
    idem = str(command['idempotency_key'])
    lease = acquire_lease(state, issue_number, idem)
    if lease['status'] == 'completed':
        return {'ok': True, 'replayed': True, 'result': lease['result']}
    if lease['status'] == 'busy':
        return {'ok': False, 'busy': True, 'lease': lease['lease']}
    heartbeat(state, issue_number)
    started = time.monotonic()
    try:
        result = execute_command(command)
        result['elapsed_ms'] = int((time.monotonic() - started) * 1000)
        finish(state, issue_number, idem, result)
        return result
    except Exception as e:
        state['leases'].pop(str(issue_number), None)
        save_state(state)
        append_audit({'event': 'failed', 'issue_number': issue_number, 'idempotency_key': idem, 'error': f'{type(e).__name__}: {e}'})
        return {'ok': False, 'error': f'{type(e).__name__}: {e}'}
