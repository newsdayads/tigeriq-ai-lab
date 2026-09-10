import hashlib
import json
import os
import subprocess
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from control_plane_v2 import execute_once as execute_control_once, parse_command_body

REPO = os.getenv('TIGERIQ_REPO', 'newsdayads/tigeriq-ai-lab')
MODEL = os.getenv('TIGERIQ_OLLAMA_MODEL', 'qwen2.5-coder:14b')
OLLAMA = os.getenv('TIGERIQ_OLLAMA_URL', 'http://127.0.0.1:11434')
POLL_SECONDS = int(os.getenv('TIGERIQ_POLL_SECONDS', '30'))
STATE_PATH = Path(os.getenv('TIGERIQ_QUEUE_STATE', r'F:\TigerIQ\Worker\queue-state.json'))
WORKSPACE = Path(os.getenv('TIGERIQ_WORKSPACE', r'F:\TigerIQ\Workspace\tigeriq-ai-lab'))
JOB_MARKER = 'TIGERIQ_JOB_V1'
COMMAND_MARKER = 'TIGERIQ_COMMAND_V1'
CLAIM = 'TIGERIQ_PC01_CLAIMED'
HEARTBEAT = 'TIGERIQ_PC01_HEARTBEAT'
DONE = 'TIGERIQ_PC01_DONE'
FAILED = 'TIGERIQ_PC01_FAILED'
MAX_STEPS = int(os.getenv('TIGERIQ_AGENT_MAX_STEPS', '16'))
MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '90'))
JOB_DEADLINE = int(os.getenv('TIGERIQ_JOB_DEADLINE_SECONDS', '900'))
LEASE_SECONDS = int(os.getenv('TIGERIQ_JOB_LEASE_SECONDS', '300'))
MAX_RETRIES = int(os.getenv('TIGERIQ_JOB_MAX_RETRIES', '2'))
MAX_OUTPUT = 12000
ALLOWED_EXE = {'git', 'gh', 'python', 'py', 'node', 'npm', 'npx', 'powershell.exe'}
BLOCKED_FRAGMENTS = (
    'git push origin main', 'git push origin master', 'git push --force',
    'git reset --hard', 'git clean -fd', 'gh pr merge', 'gh repo delete',
    'gh secret ', 'del /s', 'rmdir /s', 'format ', 'shutdown ', 'restart-computer',
    '-encodedcommand', ' -command '
)


def now_dt():
    return datetime.now(timezone.utc)


def now():
    return now_dt().isoformat()


def gh(*args):
    p = subprocess.run(['gh', *args], text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=120)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip())
    return p.stdout


def load_state():
    try:
        state = json.loads(STATE_PATH.read_text(encoding='utf-8'))
        if not isinstance(state, dict):
            raise ValueError('invalid state')
    except Exception:
        state = {}
    state.setdefault('done', [])
    state.setdefault('leases', {})
    state.setdefault('attempts', {})
    return state


def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(STATE_PATH)


def issue_comments(number):
    owner, repo = REPO.split('/', 1)
    return json.loads(gh('api', f'repos/{owner}/{repo}/issues/{number}/comments', '--paginate') or '[]')


def issue_state(number):
    return json.loads(gh('issue', 'view', str(number), '--repo', REPO, '--json', 'state,stateReason') or '{}')


def comment(number, body):
    gh('issue', 'comment', str(number), '--repo', REPO, '--body', body)


def close_issue(number):
    gh('issue', 'close', str(number), '--repo', REPO)


def list_jobs():
    raw = gh('issue', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,body,url,updatedAt')
    jobs = [x for x in json.loads(raw or '[]') if JOB_MARKER in (x.get('body') or '') or COMMAND_MARKER in (x.get('body') or '')]
    def priority(x):
        text = ((x.get('title') or '') + '\n' + (x.get('body') or '')).upper()
        p0 = 0 if 'P0' in text else 1
        return (p0, x.get('number', 0))
    return sorted(jobs, key=priority)


def instruction_from(body):
    if '## Instruction' in body:
        return body.split('## Instruction', 1)[1].strip()
    return body.replace(JOB_MARKER, '').strip()


def body_key(job):
    digest = hashlib.sha256((job.get('body') or '').encode('utf-8')).hexdigest()[:16]
    return f"{job['number']}:{digest}"


def redact(text):
    if not text:
        return ''
    lowered = text.lower()
    for marker in ('authorization:', 'cookie:', 'api_key=', 'api-key=', 'token=', 'password=', 'secret='):
        if marker in lowered:
            return '[REDACTED SENSITIVE OUTPUT]'
    return text[-MAX_OUTPUT:]


def ensure_workspace():
    WORKSPACE.parent.mkdir(parents=True, exist_ok=True)
    if not (WORKSPACE / '.git').exists():
        p = subprocess.run(['git', 'clone', f'https://github.com/{REPO}.git', str(WORKSPACE)], text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=300)
        if p.returncode != 0:
            raise RuntimeError((p.stderr or p.stdout).strip())
    p = subprocess.run(['git', 'fetch', '--all', '--prune'], cwd=WORKSPACE, text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=180)
    if p.returncode != 0:
        raise RuntimeError('git fetch failed: ' + redact(p.stderr or p.stdout))


def safe_path(value):
    p = (WORKSPACE / value).resolve() if not Path(value).is_absolute() else Path(value).resolve()
    root = WORKSPACE.resolve()
    if p != root and root not in p.parents:
        raise ValueError('path outside workspace')
    return p


def run_command(argv, timeout=180):
    if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
        raise ValueError('argv must be a non-empty string list')
    exe = Path(argv[0]).name.lower()
    if exe not in ALLOWED_EXE:
        raise ValueError(f'executable not allowed: {exe}')
    joined = ' '.join(argv).lower()
    if any(x in joined for x in BLOCKED_FRAGMENTS):
        raise ValueError('blocked destructive/privileged command')
    if exe == 'powershell.exe':
        lower = [x.lower() for x in argv]
        if '-file' not in lower:
            raise ValueError('PowerShell allowed only with -File')
        idx = lower.index('-file')
        if idx + 1 >= len(argv):
            raise ValueError('PowerShell -File path missing')
        safe_path(argv[idx + 1])
    p = subprocess.run(argv, cwd=WORKSPACE, text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=min(timeout, 300))
    return {'returncode': p.returncode, 'stdout': redact(p.stdout), 'stderr': redact(p.stderr)}


def tool_read(path):
    p = safe_path(path)
    if not p.exists() or not p.is_file():
        return {'error': 'file not found'}
    data = p.read_text(encoding='utf-8', errors='replace')
    return {'content': data[:20000], 'truncated': len(data) > 20000}


def tool_write(path, content):
    p = safe_path(path)
    if '.git' in p.parts:
        raise ValueError('cannot write .git internals')
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')
    return {'written': str(p.relative_to(WORKSPACE)), 'bytes': len(content.encode('utf-8'))}


def tool_list(path='.'):
    p = safe_path(path)
    if not p.exists() or not p.is_dir():
        return {'error': 'directory not found'}
    return {'entries': [{'name': x.name, 'type': 'dir' if x.is_dir() else 'file'} for x in sorted(p.iterdir(), key=lambda x: x.name.lower())[:200]]}


def ollama_chat(messages, json_mode=False, timeout=None):
    payload = {'model': MODEL, 'messages': messages, 'stream': False, 'options': {'temperature': 0, 'num_ctx': 32768}}
    if json_mode:
        payload['format'] = 'json'
    req = urllib.request.Request(OLLAMA + '/api/chat', data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout or MODEL_TIMEOUT) as r:
        data = json.loads(r.read().decode('utf-8'))
    return data['message']['content'].strip()


def execute_with_tools(instruction, deadline_monotonic, heartbeat_fn):
    ensure_workspace()
    system = '''You are PC01 coding executor with bounded tools. Perform repository work using evidence. Return ONE JSON object per turn: {"action":"read","path":"relative/path"} {"action":"list","path":"relative/path"} {"action":"write","path":"relative/path","content":"full UTF-8 file content"} {"action":"run","argv":["git","status","--short"],"timeout":180} {"action":"finish","summary":"evidence-backed result"}. Work only in TigerIQ workspace; no main/master push/merge; no secrets; inspect before write; test before PASS.'''
    messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': instruction}]
    trace = []
    for step in range(1, MAX_STEPS + 1):
        if time.monotonic() >= deadline_monotonic:
            return 'WO_EXECUTOR_DEADLINE_EXCEEDED\n' + '\n'.join(trace[-12:])
        heartbeat_fn(step)
        raw = ollama_chat(messages, json_mode=True, timeout=min(MODEL_TIMEOUT, max(10, int(deadline_monotonic - time.monotonic()))))
        try:
            obj = json.loads(raw)
        except Exception:
            obj = None
        if not isinstance(obj, dict):
            result = {'error': 'invalid tool JSON', 'raw': raw[:1000]}
        else:
            action = obj.get('action')
            try:
                if action == 'read': result = tool_read(obj.get('path', ''))
                elif action == 'list': result = tool_list(obj.get('path', '.'))
                elif action == 'write': result = tool_write(obj.get('path', ''), obj.get('content', ''))
                elif action == 'run': result = run_command(obj.get('argv'), int(obj.get('timeout', 180)))
                elif action == 'finish':
                    return str(obj.get('summary', '')).strip() + '\n\nTOOL TRACE SUMMARY:\n' + '\n'.join(trace[-12:])
                else: result = {'error': f'unknown action: {action}'}
            except Exception as e:
                result = {'error': f'{type(e).__name__}: {e}'}
        trace.append(f"step={step} action={obj.get('action') if isinstance(obj, dict) else 'invalid'} result={json.dumps(result, ensure_ascii=False)[:1200]}")
        messages.extend([{'role': 'assistant', 'content': raw}, {'role': 'user', 'content': 'TOOL_RESULT ' + json.dumps(result, ensure_ascii=False)}])
    return 'WO_EXECUTOR_BLOCKED: maximum tool steps reached\n' + '\n'.join(trace[-12:])


def parse_pass(text):
    try:
        obj = json.loads(text)
        return bool(obj.get('pass')), str(obj.get('reason', ''))
    except Exception:
        return False, 'invalid reviewer/judge JSON'


def acquire_job_lease(state, job, key):
    lease = state['leases'].get(str(job['number']))
    if lease:
        try:
            expiry = datetime.fromisoformat(lease['expires_at'])
        except Exception:
            expiry = now_dt() - timedelta(seconds=1)
        if expiry > now_dt() and lease.get('key') != key:
            return False
    state['leases'][str(job['number'])] = {'key': key, 'claimed_at': now(), 'heartbeat_at': now(), 'expires_at': (now_dt() + timedelta(seconds=LEASE_SECONDS)).isoformat()}
    save_state(state)
    return True


def heartbeat_job(state, number, step):
    lease = state['leases'].get(str(number))
    if not lease:
        return
    lease['heartbeat_at'] = now()
    lease['expires_at'] = (now_dt() + timedelta(seconds=LEASE_SECONDS)).isoformat()
    save_state(state)
    if step in (1, 4, 8, 12, 16):
        comment(number, f'{HEARTBEAT}\ntime={now()}\nstep={step}/{MAX_STEPS}')


def execute_command_job(job):
    cmd = parse_command_body(job.get('body') or '')
    if not cmd:
        return False
    number = job['number']
    comment(number, f'{CLAIM}\nPC01 deterministic claim at {now()}\nmode=deterministic-command')
    result = execute_control_once(number, cmd)
    if issue_state(number).get('state') != 'OPEN':
        return bool(result.get('ok'))
    marker = DONE if result.get('ok') else FAILED
    comment(number, marker + '\n```json\n' + json.dumps({'timestamp': now(), 'worker': 'pc01', 'mode': 'deterministic-command', 'result': result}, ensure_ascii=False, indent=2) + '\n```')
    if result.get('ok'):
        close_issue(number)
        return True
    return False


def execute_ai_job(job, state):
    number = job['number']
    key = body_key(job)
    attempt = int(state['attempts'].get(key, 0))
    if attempt >= MAX_RETRIES:
        return False
    if not acquire_job_lease(state, job, key):
        return False
    state['attempts'][key] = attempt + 1
    save_state(state)
    instruction = instruction_from(job.get('body') or '')
    comment(number, f'{CLAIM}\nPC01 claimed at {now()}\nmodel={MODEL}\nmode=bounded-tools\nattempt={attempt + 1}/{MAX_RETRIES}\nlease_seconds={LEASE_SECONDS}')
    deadline = time.monotonic() + JOB_DEADLINE
    executor = execute_with_tools(instruction, deadline, lambda step: heartbeat_job(state, number, step))
    if issue_state(number).get('state') != 'OPEN':
        state['leases'].pop(str(number), None); save_state(state); return False
    heartbeat_job(state, number, MAX_STEPS)
    reviewer_raw = ollama_chat([{'role': 'system', 'content': 'Independent reviewer. Reject unsupported claims. JSON only: {"pass":true|false,"reason":"..."}.'}, {'role': 'user', 'content': json.dumps({'instruction': instruction, 'executor_result': executor}, ensure_ascii=False)}], json_mode=True)
    review_pass, review_reason = parse_pass(reviewer_raw)
    judge_raw = ollama_chat([{'role': 'system', 'content': 'Independent judge. DONE requires concrete evidence and reviewer PASS. JSON only: {"pass":true|false,"reason":"..."}.'}, {'role': 'user', 'content': json.dumps({'instruction': instruction, 'executor_result': executor, 'review_pass': review_pass, 'review_reason': review_reason}, ensure_ascii=False)}], json_mode=True)
    judge_pass, judge_reason = parse_pass(judge_raw)
    if issue_state(number).get('state') != 'OPEN':
        state['leases'].pop(str(number), None); save_state(state); return False
    evidence = {'timestamp': now(), 'worker': 'pc01', 'provider': 'ollama', 'model': MODEL, 'mode': 'bounded-tools', 'attempt': attempt + 1, 'executor': executor, 'review': {'pass': review_pass, 'reason': review_reason}, 'judge': {'pass': judge_pass, 'reason': judge_reason}}
    passed = review_pass and judge_pass
    comment(number, (DONE if passed else FAILED) + '\n```json\n' + json.dumps(evidence, ensure_ascii=False, indent=2) + '\n```')
    state['leases'].pop(str(number), None)
    if passed:
        state['done'] = sorted(set(state['done']) | {str(number)}, key=lambda x: int(x))
        close_issue(number)
    save_state(state)
    return passed


def main():
    state = load_state()
    print(f'{now()} TIGERIQ GITHUB QUEUE WORKER ONLINE repo={REPO} model={MODEL} mode=v2', flush=True)
    while True:
        try:
            state = load_state()
            for job in list_jobs():
                if COMMAND_MARKER in (job.get('body') or ''):
                    execute_command_job(job)
                    continue
                if str(job['number']) in set(state.get('done', [])):
                    continue
                execute_ai_job(job, state)
        except Exception as e:
            print(f'{now()} WORKER ERROR {type(e).__name__}: {e}', flush=True)
        time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    main()
