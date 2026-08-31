import hashlib
import json
import os
import time
import urllib.request
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from control_plane_v2 import execute_once as execute_control_once, execute_command as execute_control_command, parse_command_body

REPO = os.getenv('TIGERIQ_REPO', 'newsdayads/tigeriq-ai-lab')
WORKSPACE = Path(os.getenv('TIGERIQ_WORKSPACE', r'F:\TigerIQ\Workspace\tigeriq-ai-lab')).resolve()
STATE_PATH = Path(os.getenv('TIGERIQ_QUEUE_STATE', r'F:\TigerIQ\Worker\queue-state-v3.json'))
AUDIT_PATH = Path(os.getenv('TIGERIQ_WORKER_AUDIT', r'F:\TigerIQ\Worker\worker-audit-v3.jsonl'))
OLLAMA = os.getenv('TIGERIQ_OLLAMA_URL', 'http://127.0.0.1:11434')
EXECUTOR_MODEL = os.getenv('TIGERIQ_EXECUTOR_MODEL', os.getenv('TIGERIQ_OLLAMA_MODEL', 'qwen2.5-coder:14b')).strip()
REVIEWER_MODEL = os.getenv('TIGERIQ_REVIEWER_MODEL', '').strip()
JUDGE_MODEL = os.getenv('TIGERIQ_JUDGE_MODEL', '').strip()
POLL_SECONDS = int(os.getenv('TIGERIQ_POLL_SECONDS', '30'))
MODEL_TIMEOUT = int(os.getenv('TIGERIQ_MODEL_TIMEOUT', '90'))
JOB_DEADLINE = int(os.getenv('TIGERIQ_JOB_DEADLINE_SECONDS', '900'))
LEASE_SECONDS = int(os.getenv('TIGERIQ_JOB_LEASE_SECONDS', '300'))
MAX_STEPS = int(os.getenv('TIGERIQ_AGENT_MAX_STEPS', '16'))
MAX_RETRIES = int(os.getenv('TIGERIQ_JOB_MAX_RETRIES', '2'))
MAX_OUTPUT = 12000
JOB_MARKER = 'TIGERIQ_JOB_V1'
COMMAND_MARKER = 'TIGERIQ_COMMAND_V1'
CLAIM = 'TIGERIQ_PC01_CLAIMED'
HEARTBEAT = 'TIGERIQ_PC01_HEARTBEAT'
DONE = 'TIGERIQ_PC01_DONE'
FAILED = 'TIGERIQ_PC01_FAILED'
NEEDS_REVIEW = 'TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW'

AI_ACTIONS = {'read', 'list', 'write', 'repo_status', 'repo_test', 'finish'}
PROTECTED_WRITE_PREFIXES = (
    '.git', '.github/workflows', 'scripts/pc-worker',
)
SENSITIVE_NAME_PARTS = ('secret', 'credential', 'token', 'password', '.env')
REDACT_TOKENS = ('authorization:', 'cookie:', 'api_key=', 'api-key=', 'token=', 'password=', 'secret=')


def now_dt():
    return datetime.now(timezone.utc)


def now():
    return now_dt().isoformat()


def redact(value):
    text = '' if value is None else str(value)
    lowered = text.lower()
    if any(marker in lowered for marker in REDACT_TOKENS):
        return '[REDACTED SENSITIVE OUTPUT]'
    return text[-MAX_OUTPUT:]


def append_audit(event):
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    safe = {}
    for key, value in event.items():
        safe[key] = redact(value) if isinstance(value, str) else value
    with AUDIT_PATH.open('a', encoding='utf-8') as handle:
        handle.write(json.dumps(safe, ensure_ascii=False) + '\n')


def gh(*args):
    proc = subprocess.run(
        ['gh', *args], text=True, capture_output=True,
        encoding='utf-8', errors='replace', timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(redact(proc.stderr or proc.stdout))
    return proc.stdout


def load_state():
    try:
        state = json.loads(STATE_PATH.read_text(encoding='utf-8'))
        if not isinstance(state, dict):
            raise ValueError('state must be object')
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


def list_jobs():
    raw = gh('issue', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,body,url')
    jobs = [row for row in json.loads(raw or '[]') if JOB_MARKER in (row.get('body') or '') or COMMAND_MARKER in (row.get('body') or '')]
    def rank(row):
        text = ((row.get('title') or '') + '\n' + (row.get('body') or '')).upper()
        return (0 if 'P0' in text else 1, row.get('number', 0))
    return sorted(jobs, key=rank)


def issue_state(number):
    return json.loads(gh('issue', 'view', str(number), '--repo', REPO, '--json', 'state,stateReason') or '{}')


def comment(number, body):
    gh('issue', 'comment', str(number), '--repo', REPO, '--body', body)


def close_issue(number):
    gh('issue', 'close', str(number), '--repo', REPO)


def instruction_from(body):
    if '## Instruction' in body:
        return body.split('## Instruction', 1)[1].strip()
    return body.replace(JOB_MARKER, '').strip()


def body_key(job):
    digest = hashlib.sha256((job.get('body') or '').encode('utf-8')).hexdigest()[:16]
    return f"{job['number']}:{digest}"


def safe_path(value, write=False):
    candidate = (WORKSPACE / value).resolve() if not Path(value).is_absolute() else Path(value).resolve()
    if candidate != WORKSPACE and WORKSPACE not in candidate.parents:
        raise ValueError('path outside workspace')
    rel = str(candidate.relative_to(WORKSPACE)).replace('\\', '/').lower() if candidate != WORKSPACE else '.'
    if any(part in rel for part in SENSITIVE_NAME_PARTS):
        raise ValueError('sensitive path denied')
    if write and any(rel == prefix or rel.startswith(prefix + '/') for prefix in PROTECTED_WRITE_PREFIXES):
        raise ValueError('protected runtime/governance path is read-only to AI')
    return candidate


def tool_read(path):
    target = safe_path(path)
    if not target.exists() or not target.is_file():
        return {'error': 'file not found'}
    data = target.read_text(encoding='utf-8', errors='replace')
    return {'content': redact(data[:20000]), 'truncated': len(data) > 20000}


def tool_list(path='.'):
    target = safe_path(path)
    if not target.exists() or not target.is_dir():
        return {'error': 'directory not found'}
    rows = []
    for child in sorted(target.iterdir(), key=lambda item: item.name.lower())[:200]:
        name = child.name
        if any(part in name.lower() for part in SENSITIVE_NAME_PARTS):
            continue
        rows.append({'name': name, 'type': 'dir' if child.is_dir() else 'file'})
    return {'entries': rows}


def tool_write(path, content):
    if not isinstance(content, str):
        raise ValueError('content must be string')
    target = safe_path(path, write=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')
    return {'written': str(target.relative_to(WORKSPACE)), 'bytes': len(content.encode('utf-8'))}


def validate_ai_action(obj):
    if not isinstance(obj, dict):
        raise ValueError('tool request must be object')
    action = obj.get('action')
    if action not in AI_ACTIONS:
        raise ValueError(f'action not allowed: {action}')
    forbidden_keys = {'argv', 'command', 'cmd', 'shell', 'executable'}
    if forbidden_keys.intersection(obj):
        raise ValueError('raw command execution is forbidden')
    return action


def dispatch_ai_tool(obj):
    action = validate_ai_action(obj)
    if action == 'read':
        return tool_read(obj.get('path', ''))
    if action == 'list':
        return tool_list(obj.get('path', '.'))
    if action == 'write':
        return tool_write(obj.get('path', ''), obj.get('content', ''))
    if action == 'repo_status':
        return execute_control_command({'action': 'repo.status', 'args': {}})
    if action == 'repo_test':
        script = str(obj.get('script', '')).strip()
        return execute_control_command({'action': 'repo.test', 'args': {'script': script}})
    if action == 'finish':
        return {'finish': True, 'summary': redact(obj.get('summary', ''))}
    raise ValueError('unsupported action')


def ollama_chat(model, messages, json_mode=False, timeout=None):
    if not model:
        raise RuntimeError('model not configured')
    payload = {'model': model, 'messages': messages, 'stream': False, 'options': {'temperature': 0, 'num_ctx': 32768}}
    if json_mode:
        payload['format'] = 'json'
    request = urllib.request.Request(
        OLLAMA + '/api/chat', data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}, method='POST',
    )
    with urllib.request.urlopen(request, timeout=timeout or MODEL_TIMEOUT) as response:
        data = json.loads(response.read().decode('utf-8'))
    return data['message']['content'].strip()


def model_independence_ready():
    models = [EXECUTOR_MODEL, REVIEWER_MODEL, JUDGE_MODEL]
    return all(models) and len(set(models)) == 3


def acquire_lease(state, number, key):
    lease = state['leases'].get(str(number))
    if lease:
        try:
            expiry = datetime.fromisoformat(lease['expires_at'])
        except Exception:
            expiry = now_dt() - timedelta(seconds=1)
        if expiry > now_dt() and lease.get('key') != key:
            return False
    state['leases'][str(number)] = {
        'key': key, 'claimed_at': now(), 'heartbeat_at': now(),
        'expires_at': (now_dt() + timedelta(seconds=LEASE_SECONDS)).isoformat(),
    }
    save_state(state)
    return True


def heartbeat(state, number, step):
    lease = state['leases'].get(str(number))
    if not lease:
        return
    lease['heartbeat_at'] = now()
    lease['expires_at'] = (now_dt() + timedelta(seconds=LEASE_SECONDS)).isoformat()
    save_state(state)
    if step in (1, 4, 8, 12, 16):
        comment(number, f'{HEARTBEAT}\ntime={now()}\nstep={step}/{MAX_STEPS}')


def execute_ai_tools(instruction, deadline, state, number):
    system = (
        'You are the PC01 executor. You have NO shell. Return exactly one JSON object per turn using only: '
        '{"action":"read","path":"relative/path"}, {"action":"list","path":"relative/path"}, '
        '{"action":"write","path":"relative/path","content":"full text"}, '
        '{"action":"repo_status"}, {"action":"repo_test","script":"approved exact script"}, '
        '{"action":"finish","summary":"evidence-backed result"}. '
        'Never request raw commands, argv, shell, credentials, protected worker files, .git internals or workflow files.'
    )
    messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': instruction}]
    trace = []
    for step in range(1, MAX_STEPS + 1):
        if time.monotonic() >= deadline:
            return 'WO_EXECUTOR_DEADLINE_EXCEEDED\n' + '\n'.join(trace[-12:])
        heartbeat(state, number, step)
        raw = ollama_chat(EXECUTOR_MODEL, messages, json_mode=True, timeout=min(MODEL_TIMEOUT, max(10, int(deadline - time.monotonic()))))
        try:
            obj = json.loads(raw)
            result = dispatch_ai_tool(obj)
        except Exception as exc:
            obj = None
            result = {'error': f'{type(exc).__name__}: {exc}'}
        trace.append(f'step={step} result={json.dumps(result, ensure_ascii=False)[:1200]}')
        if isinstance(result, dict) and result.get('finish'):
            return result.get('summary', '') + '\n\nTOOL TRACE SUMMARY:\n' + '\n'.join(trace[-12:])
        messages.extend([{'role': 'assistant', 'content': raw}, {'role': 'user', 'content': 'TOOL_RESULT ' + json.dumps(result, ensure_ascii=False)}])
    return 'WO_EXECUTOR_BLOCKED: maximum tool steps reached\n' + '\n'.join(trace[-12:])


def parse_pass(raw):
    try:
        obj = json.loads(raw)
        return bool(obj.get('pass')), str(obj.get('reason', ''))
    except Exception:
        return False, 'invalid reviewer/judge JSON'


def execute_command_job(job):
    command = parse_command_body(job.get('body') or '')
    if not command:
        return False
    number = job['number']
    comment(number, f'{CLAIM}\nPC01 deterministic claim at {now()}\nmode=secure-v3-command')
    result = execute_control_once(number, command)
    marker = DONE if result.get('ok') else FAILED
    comment(number, marker + '\n```json\n' + json.dumps({'timestamp': now(), 'worker': 'pc01', 'mode': 'secure-v3-command', 'result': result}, ensure_ascii=False, indent=2) + '\n```')
    append_audit({'event': 'command_result', 'issue': number, 'ok': bool(result.get('ok')), 'action': command.get('action')})
    if result.get('ok') and issue_state(number).get('state') == 'OPEN':
        close_issue(number)
        return True
    return False


def execute_ai_job(job, state):
    number = job['number']
    key = body_key(job)
    attempt = int(state['attempts'].get(key, 0))
    if attempt >= MAX_RETRIES:
        return False
    if not model_independence_ready():
        comment(number, f'{NEEDS_REVIEW}\nPC01 secure-v3 refused AI execution: three distinct local model identities are not configured.')
        append_audit({'event': 'ai_refused', 'issue': number, 'reason': 'independent_models_not_configured'})
        return False
    if not acquire_lease(state, number, key):
        return False
    state['attempts'][key] = attempt + 1
    save_state(state)
    instruction = instruction_from(job.get('body') or '')
    comment(number, f'{CLAIM}\nPC01 claimed at {now()}\nmode=secure-v3-typed-tools\nattempt={attempt + 1}/{MAX_RETRIES}')
    deadline = time.monotonic() + JOB_DEADLINE
    executor = execute_ai_tools(instruction, deadline, state, number)
    review_raw = ollama_chat(REVIEWER_MODEL, [
        {'role': 'system', 'content': 'Independent reviewer. Reject unsupported claims. JSON only: {"pass":true|false,"reason":"..."}.'},
        {'role': 'user', 'content': json.dumps({'instruction': instruction, 'executor_result': executor}, ensure_ascii=False)},
    ], json_mode=True)
    review_pass, review_reason = parse_pass(review_raw)
    judge_raw = ollama_chat(JUDGE_MODEL, [
        {'role': 'system', 'content': 'Independent judge. DONE requires concrete evidence and reviewer PASS. JSON only: {"pass":true|false,"reason":"..."}.'},
        {'role': 'user', 'content': json.dumps({'instruction': instruction, 'executor_result': executor, 'review_pass': review_pass, 'review_reason': review_reason}, ensure_ascii=False)},
    ], json_mode=True)
    judge_pass, judge_reason = parse_pass(judge_raw)
    passed = review_pass and judge_pass
    evidence = {
        'timestamp': now(), 'worker': 'pc01', 'mode': 'secure-v3-typed-tools',
        'models': {'executor': EXECUTOR_MODEL, 'reviewer': REVIEWER_MODEL, 'judge': JUDGE_MODEL},
        'attempt': attempt + 1, 'executor': executor,
        'review': {'pass': review_pass, 'reason': review_reason},
        'judge': {'pass': judge_pass, 'reason': judge_reason},
    }
    comment(number, (DONE if passed else FAILED) + '\n```json\n' + json.dumps(evidence, ensure_ascii=False, indent=2) + '\n```')
    state['leases'].pop(str(number), None)
    if passed:
        state['done'] = sorted(set(state['done']) | {str(number)}, key=lambda item: int(item))
        if issue_state(number).get('state') == 'OPEN':
            close_issue(number)
    save_state(state)
    append_audit({'event': 'ai_result', 'issue': number, 'pass': passed})
    return passed


def main():
    print(f'{now()} TIGERIQ PC01 SECURE WORKER V3 ONLINE repo={REPO}', flush=True)
    while True:
        try:
            state = load_state()
            for job in list_jobs():
                body = job.get('body') or ''
                if COMMAND_MARKER in body:
                    execute_command_job(job)
                    continue
                if str(job['number']) in set(state.get('done', [])):
                    continue
                execute_ai_job(job, state)
        except Exception as exc:
            append_audit({'event': 'worker_error', 'error': f'{type(exc).__name__}: {exc}'})
            print(f'{now()} WORKER ERROR {type(exc).__name__}: {exc}', flush=True)
        time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    main()
