import hashlib
import ipaddress
import json
import os
import platform
import shutil
import subprocess
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

WORKSPACE = Path(os.getenv('TIGERIQ_WORKSPACE', r'F:\TigerIQ\Workspace\tigeriq-ai-lab')).resolve()
WORKER_DIR = Path(os.getenv('TIGERIQ_WORKER_DIR', r'F:\TigerIQ\Worker')).resolve()
STATE_PATH = Path(os.getenv('TIGERIQ_CONTROL_STATE', r'F:\TigerIQ\Worker\control-plane-state.json'))
AUDIT_PATH = Path(os.getenv('TIGERIQ_CONTROL_AUDIT', r'F:\TigerIQ\Worker\control-plane-audit.jsonl'))
WORKFORCE_JOURNAL = Path(os.getenv('TIGERIQ_WORKFORCE_JOURNAL', r'F:\TigerIQ\State\workforce.jsonl'))
LEASE_SECONDS = int(os.getenv('TIGERIQ_LEASE_SECONDS', '300'))
COMMAND_MARKER = 'TIGERIQ_COMMAND_V1'
WORKFORCE_PORT = 8790
ALLOWED_TASKS = {'TigerIQ Worker', 'TigerIQ Worker Watchdog', 'TigerIQ Command Center', 'TigerIQ Workforce Controller'}
ALLOWED_FETCH_BRANCHES = {'wo011/pc01-remote-exec', 'wo045/pc01-autonomy-hardening'}
REDACT_TOKENS = ('authorization:', 'cookie:', 'api_key=', 'api-key=', 'token=', 'password=', 'secret=', 'private_key=')
TAILNET = ipaddress.ip_network('100.64.0.0/10')


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
    except Exception:
        state = {}
    state.setdefault('completed', {})
    state.setdefault('leases', {})
    return state


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
        try:
            expires = datetime.fromisoformat(lease['expires_at'])
        except Exception:
            expires = now_dt() - timedelta(seconds=1)
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
    return lease


def finish(state, issue_number, idempotency_key, result):
    state['completed'][idempotency_key] = result
    state['leases'].pop(str(issue_number), None)
    save_state(state)
    append_audit({'event': 'completed', 'issue_number': issue_number, 'idempotency_key': idempotency_key, 'action': result.get('action'), 'ok': result.get('ok')})


def _run(argv, timeout=60, cwd=None, env=None):
    p = subprocess.run(argv, cwd=cwd or WORKSPACE, text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout, env=env)
    return {'returncode': p.returncode, 'stdout': redact(p.stdout), 'stderr': redact(p.stderr)}


def _resolve_executable(name, candidates=()):
    found = shutil.which(name)
    if found:
        return str(Path(found).resolve())
    for candidate in candidates:
        p = Path(candidate)
        if p.exists():
            return str(p.resolve())
    raise RuntimeError(f'{name} executable unavailable')


def _tailscale_exe():
    return _resolve_executable('tailscale', (
        r'C:\Program Files\Tailscale\tailscale.exe',
        r'C:\Program Files (x86)\Tailscale\tailscale.exe',
    ))


def _node_exe():
    return _resolve_executable('node', (r'C:\Program Files\nodejs\node.exe',))


def _npm_exe():
    return _resolve_executable('npm.cmd', (r'C:\Program Files\nodejs\npm.cmd',))


def _netstat_exe():
    return _resolve_executable('netstat', (r'C:\Windows\System32\netstat.exe',))


def _is_tailnet_ipv4(value):
    try:
        ip = ipaddress.ip_address(str(value).strip())
        return ip.version == 4 and ip in TAILNET
    except ValueError:
        return False


def tailscale_ipv4():
    exe = _tailscale_exe()
    result = _run([exe, 'ip', '-4'], timeout=20)
    if result['returncode'] != 0:
        raise RuntimeError('tailscale ip failed: ' + result['stderr'])
    candidates = [line.strip() for line in result['stdout'].splitlines() if line.strip()]
    valid = [x for x in candidates if _is_tailnet_ipv4(x)]
    if len(valid) != 1:
        raise RuntimeError(f'expected exactly one tailnet IPv4, got {len(valid)}')
    return valid[0]


def tailscale_status():
    exe = _tailscale_exe()
    result = _run([exe, 'status', '--json'], timeout=30)
    if result['returncode'] != 0:
        return {'ok': False, 'action': 'tailscale.status', 'error': result['stderr'] or 'tailscale status failed'}
    try:
        data = json.loads(result['stdout'] or '{}')
    except Exception:
        return {'ok': False, 'action': 'tailscale.status', 'error': 'invalid tailscale JSON'}
    self_obj = data.get('Self') if isinstance(data.get('Self'), dict) else {}
    ips = [str(x) for x in self_obj.get('TailscaleIPs', []) if _is_tailnet_ipv4(x)]
    return {
        'ok': data.get('BackendState') == 'Running' and len(ips) >= 1,
        'action': 'tailscale.status',
        'backend_state': data.get('BackendState'),
        'self_online': bool(self_obj.get('Online', True)),
        'tailnet_ipv4': ips[0] if ips else None,
    }


def listener_status(port=WORKFORCE_PORT):
    if int(port) != WORKFORCE_PORT:
        raise ValueError('only Workforce Controller port 8790 is allowed')
    result = _run([_netstat_exe(), '-ano', '-p', 'tcp'], timeout=20)
    if result['returncode'] != 0:
        return {'ok': False, 'action': 'listener.status', 'port': WORKFORCE_PORT, 'error': result['stderr'] or 'netstat failed'}
    listeners = []
    for raw in result['stdout'].splitlines():
        line = raw.strip()
        if not line.upper().startswith('TCP') or 'LISTENING' not in line.upper():
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        local = parts[1]
        state = parts[3].upper()
        pid = parts[4]
        if state != 'LISTENING':
            continue
        if local.startswith('['):
            host, _, port_text = local.rpartition(']:')
            host = host.lstrip('[')
        else:
            host, sep, port_text = local.rpartition(':')
            if not sep:
                continue
        try:
            if int(port_text) != WORKFORCE_PORT:
                continue
        except ValueError:
            continue
        listeners.append({'address': host, 'pid': int(pid) if pid.isdigit() else None})
    wildcard = any(row['address'] in {'0.0.0.0', '::', '[::]'} for row in listeners)
    public = []
    for row in listeners:
        address = row['address']
        if address in {'127.0.0.1', '::1'} or _is_tailnet_ipv4(address):
            continue
        try:
            if ipaddress.ip_address(address).is_private:
                continue
        except ValueError:
            pass
        public.append(address)
    return {
        'ok': not wildcard and not public,
        'action': 'listener.status',
        'port': WORKFORCE_PORT,
        'listeners': listeners,
        'wildcard_listener': wildcard,
        'public_listener': sorted(set(public)),
    }


def workforce_status():
    ip = tailscale_ipv4()
    url = f'http://{ip}:{WORKFORCE_PORT}/api/workforce/status'
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            body = response.read(256000)
            code = int(response.status)
    except Exception as exc:
        return {'ok': False, 'action': 'workforce.controller.status', 'host': ip, 'port': WORKFORCE_PORT, 'http_status': None, 'error': f'{type(exc).__name__}: {exc}', 'listener': listener_status()}
    listeners = listener_status()
    expected = [row for row in listeners.get('listeners', []) if row.get('address') == ip]
    return {
        'ok': code == 200 and bool(expected) and listeners.get('ok') and not listeners.get('wildcard_listener'),
        'action': 'workforce.controller.status',
        'host': ip,
        'port': WORKFORCE_PORT,
        'http_status': code,
        'body_sha256': hashlib.sha256(body).hexdigest(),
        'listener': listeners,
    }


def workforce_build():
    package = WORKSPACE / 'package.json'
    if not package.exists():
        return {'ok': False, 'action': 'workforce.controller.build', 'error': 'package.json missing'}
    result = _run([_npm_exe(), 'run', 'build'], timeout=240, cwd=WORKSPACE)
    return {'ok': result['returncode'] == 0, 'action': 'workforce.controller.build', 'result': result}


def workforce_start():
    ip = tailscale_ipv4()
    current = listener_status()
    if current.get('listeners'):
        status = workforce_status()
        status['action'] = 'workforce.controller.ensure'
        status['already_running'] = True
        return status
    entry = WORKSPACE / 'dist' / 'apps' / 'workforce-controller' / 'src' / 'standalone.js'
    if not entry.exists():
        built = workforce_build()
        if not built.get('ok'):
            return {'ok': False, 'action': 'workforce.controller.ensure', 'stage': 'build', 'build': built}
    if not entry.exists():
        return {'ok': False, 'action': 'workforce.controller.ensure', 'error': 'built controller entry missing'}
    WORKFORCE_JOURNAL.parent.mkdir(parents=True, exist_ok=True)
    WORKER_DIR.mkdir(parents=True, exist_ok=True)
    log_path = WORKER_DIR / 'workforce-controller.log'
    env = os.environ.copy()
    env['TIGERIQ_WORKFORCE_HOST'] = ip
    env['TIGERIQ_WORKFORCE_PORT'] = str(WORKFORCE_PORT)
    env['TIGERIQ_WORKFORCE_ALLOW_TAILNET_SELF_PAIR'] = '1'
    env['TIGERIQ_WORKFORCE_JOURNAL'] = str(WORKFORCE_JOURNAL)
    env.pop('TIGERIQ_WORKFORCE_ADMIN_SECRET', None)
    flags = 0
    if os.name == 'nt':
        flags = getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
    with log_path.open('ab') as log:
        proc = subprocess.Popen(
            [_node_exe(), str(entry)], cwd=WORKSPACE, env=env,
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            creationflags=flags, close_fds=True,
        )
    deadline = time.time() + 20
    last = None
    while time.time() < deadline:
        time.sleep(1)
        last = workforce_status()
        if last.get('ok'):
            return {'ok': True, 'action': 'workforce.controller.ensure', 'started_pid': proc.pid, 'status': last}
        if proc.poll() is not None:
            break
    return {'ok': False, 'action': 'workforce.controller.ensure', 'started_pid': proc.pid, 'process_returncode': proc.poll(), 'status': last}


def task_action(action, task):
    task = str(task or '').strip()
    if task not in ALLOWED_TASKS:
        raise ValueError('task not allowlisted')
    if action == 'tigeriq.task.status':
        argv = ['schtasks', '/Query', '/TN', task, '/FO', 'LIST', '/V']
    elif action == 'tigeriq.task.start':
        argv = ['schtasks', '/Run', '/TN', task]
    elif action == 'tigeriq.task.stop':
        argv = ['schtasks', '/End', '/TN', task]
    else:
        raise ValueError('unsupported task action')
    result = _run(argv, timeout=30)
    return {'ok': result['returncode'] == 0, 'action': action, 'task': task, 'result': result}


def pc01_runtime_status():
    system = {
        'hostname': platform.node(),
        'platform': platform.platform(),
        'python': platform.python_version(),
        'workspace_exists': WORKSPACE.exists(),
    }
    ts = tailscale_status()
    listener = listener_status()
    worker = task_action('tigeriq.task.status', 'TigerIQ Worker')
    watchdog = task_action('tigeriq.task.status', 'TigerIQ Worker Watchdog')
    controller = workforce_status() if ts.get('ok') else {'ok': False, 'action': 'workforce.controller.status', 'error': 'tailscale not ready'}
    return {
        'ok': system['hostname'].upper() == 'PC01' and worker.get('ok') and watchdog.get('ok'),
        'action': 'pc01.runtime.status',
        'system': system,
        'tailscale': ts,
        'worker_task_ok': worker.get('ok'),
        'watchdog_task_ok': watchdog.get('ok'),
        'listener': listener,
        'workforce': controller,
    }


def execute_command(command):
    if not isinstance(command, dict):
        raise ValueError('command must be object')
    action = command.get('action')
    args = command.get('args') or {}
    if not isinstance(args, dict):
        raise ValueError('args must be object')

    if action == 'system.status':
        return {'ok': True, 'action': action, 'hostname': platform.node(), 'platform': platform.platform(), 'python': platform.python_version(), 'workspace_exists': WORKSPACE.exists()}
    if action == 'ollama.status':
        result = _run(['ollama', 'list'], timeout=30)
        return {'ok': result['returncode'] == 0, 'action': action, 'result': result}
    if action == 'ollama.unload':
        model = str(args.get('model', '')).strip()
        if not model or any(x in model for x in (' ', ';', '&', '|', '/', '\\')):
            raise ValueError('invalid model name')
        result = _run(['ollama', 'stop', model], timeout=30)
        return {'ok': result['returncode'] == 0, 'action': action, 'result': result}
    if action in {'tigeriq.task.status', 'tigeriq.task.start', 'tigeriq.task.stop'}:
        return task_action(action, args.get('task'))
    if action == 'tailscale.status':
        return tailscale_status()
    if action == 'tailscale.ipv4':
        return {'ok': True, 'action': action, 'ipv4': tailscale_ipv4(), 'tailnet': '100.64.0.0/10'}
    if action == 'listener.status':
        return listener_status(args.get('port', WORKFORCE_PORT))
    if action == 'workforce.controller.build':
        if args:
            raise ValueError('workforce build takes no arguments')
        return workforce_build()
    if action in {'workforce.controller.start', 'workforce.controller.ensure'}:
        if args:
            raise ValueError('workforce ensure takes no arguments')
        return workforce_start()
    if action == 'workforce.controller.status':
        if args:
            raise ValueError('workforce status takes no arguments')
        return workforce_status()
    if action == 'pc01.runtime.status':
        if args:
            raise ValueError('pc01 runtime status takes no arguments')
        return pc01_runtime_status()
    if action == 'repo.status':
        result = _run(['git', 'status', '--short', '--branch'], timeout=30)
        return {'ok': result['returncode'] == 0, 'action': action, 'result': result}
    if action == 'repo.fetch':
        branch = str(args.get('branch', '')).strip()
        if branch not in ALLOWED_FETCH_BRANCHES:
            raise ValueError('branch not allowlisted')
        result = _run(['git', 'fetch', 'origin', branch, '--prune'], timeout=120)
        return {'ok': result['returncode'] == 0, 'action': action, 'branch': branch, 'result': result}
    if action == 'repo.test':
        script = str(args.get('script', '')).strip()
        approved = {
            'python -m py_compile scripts/pc-worker/worker_secure_v3.py scripts/pc-worker/control_plane_v2.py scripts/pc-worker/live_upgrade_secure_v3.py',
            'python scripts/pc-worker/test_control_plane_v2.py',
            'python scripts/pc-worker/test_worker_secure_v3.py',
            'python scripts/pc-worker/test_watchdog_v3_contract.py',
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
        return {'ok': False, 'action': command.get('action'), 'error': f'{type(e).__name__}: {e}'}
