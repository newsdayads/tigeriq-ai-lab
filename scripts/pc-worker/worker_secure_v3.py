import hashlib
import json
import os
import re
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
PUBLIC_EVIDENCE_SUPPRESSED = 'TIGERIQ_PUBLIC_EVIDENCE_SUPPRESSED'

AI_ACTIONS = {'read', 'list', 'write', 'repo_status', 'repo_test', 'finish'}
PROTECTED_PATH_PREFIXES = ('.git', '.github', 'scripts/pc-worker')
READABLE_PREFIXES = ('apps', 'docs', 'packages', 'schemas', 'src', 'tests', 'scripts', 'scratch')
WRITABLE_PREFIXES = ('apps', 'docs', 'packages', 'schemas', 'src', 'tests', 'scripts', 'scratch')
READABLE_ROOT_FILES = {
    'README.md', 'AGENTS.md', 'LICENSE', '.gitignore', 'package.json', 'package-lock.json',
    'playwright.config.ts', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts',
}
WRITABLE_ROOT_FILES = {
    'README.md', 'AGENTS.md', '.gitignore', 'package.json', 'package-lock.json',
    'playwright.config.ts', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts',
}
SENSITIVE_NAME_PARTS = ('secret', 'credential', 'token', 'password', '.env', '.netrc', '.npmrc', '.pypirc')

PEM_RE = re.compile(r'-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----', re.I | re.S)
AUTH_RE = re.compile(r'\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=:-]+', re.I)
CRED_URL_RE = re.compile(r'(https?://)[^/\s:@]+:[^@\s/]+@', re.I)
KEY_VALUE_RE = re.compile(
    r'(?im)(["\']?(?:api[_-]?key|token|secret|authorization|password|private[_-]?key|cookie)["\']?\s*[:=]\s*["\']?)([^\s,"\'}\r\n]+)'
)
TOKEN_PATTERNS = (
    re.compile(r'\bgithub_pat_[A-Za-z0-9_]{20,}\b'),
    re.compile(r'\bgh[pousr]_[A-Za-z0-9_]{20,}\b'),
    re.compile(r'\bAIza[0-9A-Za-z_-]{20,}\b'),
    re.compile(r'\bsk-[A-Za-z0-9_-]{16,}\b'),
)
DIGEST_RE = re.compile(r'^(?:sha256:)?([0-9a-fA-F]{64})$')

_TRACKED_CACHE = None
AI_CREATED_FILES = set()


def now_dt():
    return datetime.now(timezone.utc)


def now():
    return now_dt().isoformat()


def _normalize_rel(path):
    return str(path).replace('\\', '/').lstrip('./').lower() or '.'


def _is_prefix(rel, prefixes):
    return any(rel == prefix or rel.startswith(prefix + '/') for prefix in prefixes)


def redact(value):
    text = '' if value is None else str(value)
    text = PEM_RE.sub('[REDACTED PRIVATE KEY]', text)
    text = AUTH_RE.sub(lambda match: match.group(1) + ' REDACTED', text)
    text = CRED_URL_RE.sub(r'\1REDACTED@', text)
    text = KEY_VALUE_RE.sub(lambda match: match.group(1) + 'REDACTED', text)
    for pattern in TOKEN_PATTERNS:
        text = pattern.sub('[REDACTED TOKEN]', text)
    if len(text) > MAX_OUTPUT:
        text = text[:MAX_OUTPUT] + '\n[TRUNCATED]'
    return text


def _contains_sensitive(text):
    if PEM_RE.search(text) or CRED_URL_RE.search(text):
        return True
    for pattern in TOKEN_PATTERNS:
        if pattern.search(text):
            return True
    auth = AUTH_RE.search(text)
    if auth and 'REDACTED' not in auth.group(0).upper():
        return True
    for match in KEY_VALUE_RE.finditer(text):
        if 'REDACTED' not in match.group(2).upper():
            return True
    return False


def sanitize_value(value):
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {str(key): sanitize_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_value(item) for item in value]
    return value


def public_json(value):
    text = json.dumps(sanitize_value(value), ensure_ascii=False, indent=2)
    text = redact(text)
    if _contains_sensitive(text):
        return json.dumps({'status': PUBLIC_EVIDENCE_SUPPRESSED}, ensure_ascii=False, indent=2)
    return text


def append_audit(event):
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    safe = sanitize_value(event)
    text = redact(json.dumps(safe, ensure_ascii=False))
    if _contains_sensitive(text):
        text = json.dumps({'event': PUBLIC_EVIDENCE_SUPPRESSED, 'timestamp': now()}, ensure_ascii=False)
    with AUDIT_PATH.open('a', encoding='utf-8') as handle:
        handle.write(text + '\n')


def gh(*args):
    proc = subprocess.run(
        ['gh', *args], text=True, capture_output=True,
        encoding='utf-8', errors='replace', timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(redact(proc.stderr or proc.stdout))
    return proc.stdout


def tracked_files():
    global _TRACKED_CACHE
    if _TRACKED_CACHE is not None:
        return set(_TRACKED_CACHE)
    proc = subprocess.run(
        ['git', '-C', str(WORKSPACE), 'ls-files', '-z'],
        text=False, capture_output=True, timeout=60,
    )
    if proc.returncode != 0:
        _TRACKED_CACHE = set()
        append_audit({'event': 'tracked_scope_unavailable', 'returncode': proc.returncode})
        return set()
    rows = proc.stdout.decode('utf-8', errors='replace').split('\x00')
    _TRACKED_CACHE = {_normalize_rel(row) for row in rows if row}
    return set(_TRACKED_CACHE)


def _scope_allowed(rel, write=False, directory=False):
    if rel == '.':
        return not write and directory
    if _is_prefix(rel, PROTECTED_PATH_PREFIXES):
        return False
    root = rel.split('/', 1)[0]
    if '/' not in rel:
        if directory:
            prefixes = WRITABLE_PREFIXES if write else READABLE_PREFIXES
            return root in prefixes
        roots = WRITABLE_ROOT_FILES if write else READABLE_ROOT_FILES
        return rel in {item.lower() for item in roots}
    prefixes = WRITABLE_PREFIXES if write else READABLE_PREFIXES
    return root in prefixes


def _resolve_ai_path(value, write=False, directory=False):
    raw = str(value or '').strip()
    if not raw or Path(raw).is_absolute():
        raise ValueError('relative workspace path required')
    candidate = (WORKSPACE / raw).resolve()
    if candidate != WORKSPACE and WORKSPACE not in candidate.parents:
        raise ValueError('path outside workspace')
    rel = _normalize_rel(candidate.relative_to(WORKSPACE)) if candidate != WORKSPACE else '.'
    if any(part in rel for part in SENSITIVE_NAME_PARTS):
        raise ValueError('sensitive path denied')
    if not _scope_allowed(rel, write=write, directory=directory):
        raise ValueError('path outside AI scope')
    return candidate, rel


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
    safe = redact(body)
    if _contains_sensitive(safe):
        safe = f'{PUBLIC_EVIDENCE_SUPPRESSED}\ntime={now()}'
        append_audit({'event': 'public_comment_suppressed', 'issue': number})
    gh('issue', 'comment', str(number), '--repo', REPO, '--body', safe)


def close_issue(number):
    gh('issue', 'close', str(number), '--repo', REPO)


def instruction_from(body):
    if '## Instruction' in body:
        return body.split('## Instruction', 1)[1].strip()
    return body.replace(JOB_MARKER, '').strip()


def body_key(job):
    digest = hashlib.sha256((job.get('body') or '').encode('utf-8')).hexdigest()[:16]
    return f"{job['number']}:{digest}"


def tool_read(path):
    target, rel = _resolve_ai_path(path, write=False, directory=False)
    if rel not in tracked_files() and rel not in AI_CREATED_FILES:
        raise ValueError('read denied: file is not repository-tracked or AI-created')
    if not target.exists() or not target.is_file():
        return {'error': 'file not found'}
    data = target.read_text(encoding='utf-8', errors='replace')
    bounded = data[:20000]
    return {
        'content': bounded,
        'truncated': len(data) > 20000,
        'path': rel,
        'bytes': len(data.encode('utf-8', errors='replace')),
        'sha256': hashlib.sha256(data.encode('utf-8', errors='replace')).hexdigest(),
    }


def tool_list(path='.'):
    target, rel = _resolve_ai_path(path, write=False, directory=True)
    if not target.exists() or not target.is_dir():
        return {'error': 'directory not found'}
    known = tracked_files() | set(AI_CREATED_FILES)
    prefix = '' if rel == '.' else rel + '/'
    names = {}
    for item in known:
        if not item.startswith(prefix):
            continue
        tail = item[len(prefix):]
        if not tail:
            continue
        name = tail.split('/', 1)[0]
        child_rel = name if rel == '.' else rel + '/' + name
        child_is_dir = '/' in tail
        if any(part in child_rel for part in SENSITIVE_NAME_PARTS):
            continue
        if not _scope_allowed(child_rel, write=False, directory=child_is_dir):
            continue
        names[name] = 'dir' if child_is_dir else 'file'
    rows = [{'name': name, 'type': names[name]} for name in sorted(names, key=str.lower)[:200]]
    return {'entries': rows}


def tool_write(path, content):
    if not isinstance(content, str):
        raise ValueError('content must be string')
    target, rel = _resolve_ai_path(path, write=True, directory=False)
    if target.exists() and rel not in tracked_files() and rel not in AI_CREATED_FILES:
        raise ValueError('write denied: existing untracked file')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')
    AI_CREATED_FILES.add(rel)
    digest = hashlib.sha256(content.encode('utf-8')).hexdigest()
    return {'written': rel, 'bytes': len(content.encode('utf-8')), 'sha256': digest}


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


def _public_tool_metadata(step, obj, result):
    action = obj.get('action') if isinstance(obj, dict) else 'invalid'
    meta = {'step': step, 'action': action, 'ok': not (isinstance(result, dict) and result.get('error'))}
    if isinstance(obj, dict) and action in {'read', 'list', 'write'}:
        meta['path'] = redact(obj.get('path', '.'))
    if isinstance(result, dict):
        for key in ('bytes', 'sha256', 'truncated', 'written', 'returncode'):
            if key in result:
                meta[key] = result[key]
        if action == 'list' and isinstance(result.get('entries'), list):
            meta['entry_count'] = len(result['entries'])
        if action in {'repo_status', 'repo_test'}:
            nested = result.get('result') if isinstance(result.get('result'), dict) else {}
            meta['returncode'] = nested.get('returncode')
            combined = str(nested.get('stdout', '')) + '\n' + str(nested.get('stderr', ''))
            meta['output_sha256'] = hashlib.sha256(combined.encode('utf-8', errors='replace')).hexdigest()
        if result.get('error'):
            meta['error'] = redact(result.get('error'))
    return sanitize_value(meta)


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


def ollama_model_catalog():
    request = urllib.request.Request(OLLAMA + '/api/tags', method='GET')
    with urllib.request.urlopen(request, timeout=min(MODEL_TIMEOUT, 30)) as response:
        data = json.loads(response.read().decode('utf-8'))
    catalog = {}
    for row in data.get('models', []):
        digest = str(row.get('digest', '')).strip().lower()
        match = DIGEST_RE.match(digest)
        if not match:
            continue
        normalized = match.group(1).lower()
        for key in (row.get('name'), row.get('model')):
            if key:
                catalog[str(key).strip()] = normalized
    return catalog


def model_identities():
    models = {'executor': EXECUTOR_MODEL, 'reviewer': REVIEWER_MODEL, 'judge': JUDGE_MODEL}
    if not all(models.values()):
        return None
    try:
        catalog = ollama_model_catalog()
    except Exception as exc:
        append_audit({'event': 'model_identity_probe_failed', 'error': f'{type(exc).__name__}: {exc}'})
        return None
    identities = {}
    for role, model in models.items():
        digest = catalog.get(model)
        if not digest:
            return None
        identities[role] = {'model': model, 'digest': digest}
    return identities


def model_independence_ready(identities=None):
    identities = identities if identities is not None else model_identities()
    if not identities or set(identities) != {'executor', 'reviewer', 'judge'}:
        return False
    digests = [identities[role].get('digest') for role in ('executor', 'reviewer', 'judge')]
    return all(digests) and len(set(digests)) == 3


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
        'Reads are limited to repository-tracked files in an explicit scope; writes cannot touch worker/governance/runtime internals. '
        'Never request raw commands, argv, shell, credentials, .git internals, workflow files or PC worker files.'
    )
    messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': instruction}]
    public_trace = []
    for step in range(1, MAX_STEPS + 1):
        if time.monotonic() >= deadline:
            return {'summary': 'WO_EXECUTOR_DEADLINE_EXCEEDED', 'trace': public_trace[-12:]}
        heartbeat(state, number, step)
        raw = ollama_chat(EXECUTOR_MODEL, messages, json_mode=True, timeout=min(MODEL_TIMEOUT, max(10, int(deadline - time.monotonic()))))
        try:
            obj = json.loads(raw)
            result = dispatch_ai_tool(obj)
        except Exception as exc:
            obj = None
            result = {'error': f'{type(exc).__name__}: {exc}'}
        public_trace.append(_public_tool_metadata(step, obj, result))
        if isinstance(result, dict) and result.get('finish'):
            return {'summary': redact(result.get('summary', '')), 'trace': public_trace[-12:]}
        messages.extend([
            {'role': 'assistant', 'content': raw},
            {'role': 'user', 'content': 'TOOL_RESULT ' + json.dumps(result, ensure_ascii=False)},
        ])
    return {'summary': 'WO_EXECUTOR_BLOCKED: maximum tool steps reached', 'trace': public_trace[-12:]}


def parse_pass(raw):
    try:
        obj = json.loads(raw)
        return bool(obj.get('pass')), redact(obj.get('reason', ''))
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
    evidence = {'timestamp': now(), 'worker': 'pc01', 'mode': 'secure-v3-command', 'result': sanitize_value(result)}
    comment(number, marker + '\n```json\n' + public_json(evidence) + '\n```')
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
    identities = model_identities()
    if not model_independence_ready(identities):
        comment(number, f'{NEEDS_REVIEW}\nPC01 secure-v3 refused AI execution: three distinct immutable local model digests are not configured/proven.')
        append_audit({'event': 'ai_refused', 'issue': number, 'reason': 'independent_model_digests_not_proven'})
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
        {'role': 'user', 'content': json.dumps({'instruction': redact(instruction), 'executor_result': executor}, ensure_ascii=False)},
    ], json_mode=True)
    review_pass, review_reason = parse_pass(review_raw)
    judge_raw = ollama_chat(JUDGE_MODEL, [
        {'role': 'system', 'content': 'Independent judge. DONE requires concrete evidence and reviewer PASS. JSON only: {"pass":true|false,"reason":"..."}.'},
        {'role': 'user', 'content': json.dumps({
            'instruction': redact(instruction), 'executor_result': executor,
            'review_pass': review_pass, 'review_reason': review_reason,
        }, ensure_ascii=False)},
    ], json_mode=True)
    judge_pass, judge_reason = parse_pass(judge_raw)

    # Tags/aliases can move while a job is executing. Re-resolve and require the same immutable digests.
    identities_after = model_identities()
    identity_stable = model_independence_ready(identities_after) and identities_after == identities
    passed = review_pass and judge_pass and identity_stable
    evidence = {
        'timestamp': now(), 'worker': 'pc01', 'mode': 'secure-v3-typed-tools',
        'models': identities,
        'model_identity_stable': identity_stable,
        'attempt': attempt + 1,
        'executor': executor,
        'review': {'pass': review_pass, 'reason': review_reason},
        'judge': {'pass': judge_pass, 'reason': judge_reason},
    }
    comment(number, (DONE if passed else FAILED) + '\n```json\n' + public_json(evidence) + '\n```')
    state['leases'].pop(str(number), None)
    if passed:
        state['done'] = sorted(set(state['done']) | {str(number)}, key=lambda item: int(item))
        if issue_state(number).get('state') == 'OPEN':
            close_issue(number)
    save_state(state)
    append_audit({'event': 'ai_result', 'issue': number, 'pass': passed, 'model_identity_stable': identity_stable})
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
            print(f'{now()} WORKER ERROR {type(exc).__name__}: {redact(exc)}', flush=True)
        time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    main()
