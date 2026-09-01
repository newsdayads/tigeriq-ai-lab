import hashlib
import json
import os
import re
import subprocess
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from control_plane_v2 import execute_once as execute_control_once, execute_command as execute_control_command, parse_command_body

REPO = os.getenv('TIGERIQ_REPO', 'newsdayads/tigeriq-ai-lab')
STATE_PATH = Path(os.getenv('TIGERIQ_QUEUE_STATE', r'F:\TigerIQ\Worker\queue-state-v3.json'))
AUDIT_PATH = Path(os.getenv('TIGERIQ_WORKER_AUDIT', r'F:\TigerIQ\Worker\worker-audit-v3.jsonl'))
INSTANCE_LOCK = Path(os.getenv('TIGERIQ_WORKER_LOCK', r'F:\TigerIQ\Worker\worker-v3.lock'))
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
CANONICAL_PC01_ISSUES = {57, 58, 100, 133, 137}
EXCLUDED_ISSUES = {138}
EXCLUDED_TITLE_MARKERS = ('WEB CONTROL', '[WEB', 'ANDROID', '[ANDROID', 'WORK BOARD', 'BẢNG TRẠNG THÁI', 'COMPANY PROGRESS')
AI_ACTIONS = {
    'repo_status', 'repo_test', 'pc01_status', 'tailscale_status', 'tailscale_ipv4',
    'listener_status', 'workforce_build', 'workforce_start', 'workforce_status',
    'task_status', 'task_start', 'task_stop', 'ollama_status', 'finish',
}
ALLOWED_TASKS = {'TigerIQ Worker', 'TigerIQ Worker Watchdog', 'TigerIQ Command Center', 'TigerIQ Workforce Controller'}
PEM_RE = re.compile(r'-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----', re.I | re.S)
AUTH_RE = re.compile(r'\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=:-]+', re.I)
CRED_URL_RE = re.compile(r'(https?://)[^/\s:@]+:[^@\s/]+@', re.I)
KEY_VALUE_RE = re.compile(r'(?im)(["\']?(?:api[_-]?key|token|secret|authorization|password|private[_-]?key|cookie)["\']?\s*[:=]\s*["\']?)([^\s,"\'}\r\n]+)')
TOKEN_PATTERNS = (
    re.compile(r'\bgithub_pat_[A-Za-z0-9_]{20,}\b'), re.compile(r'\bgh[pousr]_[A-Za-z0-9_]{20,}\b'),
    re.compile(r'\bAIza[0-9A-Za-z_-]{20,}\b'), re.compile(r'\bsk-[A-Za-z0-9_-]{16,}\b'),
)
DIGEST_RE = re.compile(r'^(?:sha256:)?([0-9a-fA-F]{64})$')
_LOCK_HANDLE = None


def now_dt(): return datetime.now(timezone.utc)
def now(): return now_dt().isoformat()


def redact(value):
    text = '' if value is None else str(value)
    text = PEM_RE.sub('[REDACTED PRIVATE KEY]', text)
    text = AUTH_RE.sub(lambda m: m.group(1) + ' REDACTED', text)
    text = CRED_URL_RE.sub(r'\1REDACTED@', text)
    text = KEY_VALUE_RE.sub(lambda m: m.group(1) + 'REDACTED', text)
    for pattern in TOKEN_PATTERNS: text = pattern.sub('[REDACTED TOKEN]', text)
    return text[:MAX_OUTPUT] + ('\n[TRUNCATED]' if len(text) > MAX_OUTPUT else '')


def _contains_sensitive(text):
    if PEM_RE.search(text) or CRED_URL_RE.search(text) or any(p.search(text) for p in TOKEN_PATTERNS): return True
    auth = AUTH_RE.search(text)
    if auth and 'REDACTED' not in auth.group(0).upper(): return True
    return any('REDACTED' not in m.group(2).upper() for m in KEY_VALUE_RE.finditer(text))


def sanitize_value(value):
    if isinstance(value, str): return redact(value)
    if isinstance(value, dict): return {str(k): sanitize_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [sanitize_value(v) for v in value]
    return value


def public_json(value):
    text = redact(json.dumps(sanitize_value(value), ensure_ascii=False, indent=2))
    return json.dumps({'status': PUBLIC_EVIDENCE_SUPPRESSED}, ensure_ascii=False, indent=2) if _contains_sensitive(text) else text


def append_audit(event):
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = redact(json.dumps(sanitize_value(event), ensure_ascii=False))
    if _contains_sensitive(text): text = json.dumps({'event': PUBLIC_EVIDENCE_SUPPRESSED, 'timestamp': now()}, ensure_ascii=False)
    with AUDIT_PATH.open('a', encoding='utf-8') as handle: handle.write(text + '\n')


def gh(*args):
    p = subprocess.run(['gh', *args], text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=120)
    if p.returncode != 0: raise RuntimeError(redact(p.stderr or p.stdout))
    return p.stdout


def acquire_instance_lock():
    global _LOCK_HANDLE
    INSTANCE_LOCK.parent.mkdir(parents=True, exist_ok=True)
    handle = INSTANCE_LOCK.open('a+b'); handle.seek(0, 2)
    if handle.tell() == 0: handle.write(b'0'); handle.flush()
    handle.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt; msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl; fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        handle.close(); return False
    _LOCK_HANDLE = handle; return True


def load_state():
    try:
        state = json.loads(STATE_PATH.read_text(encoding='utf-8'))
        if not isinstance(state, dict): raise ValueError('state must be object')
    except Exception: state = {}
    state.setdefault('done', []); state.setdefault('leases', {}); state.setdefault('attempts', {})
    return state


def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix('.tmp'); tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8'); tmp.replace(STATE_PATH)


def _flag(body, name):
    match = re.search(rf'(?im)^\s*{re.escape(name)}\s*=\s*(true|false)\s*$', body or '')
    return None if not match else match.group(1).lower() == 'true'


def job_is_pc01(job):
    number = int(job.get('number') or 0); title = str(job.get('title') or ''); body = str(job.get('body') or ''); upper = title.upper()
    if number in EXCLUDED_ISSUES or _flag(body, 'PC01_REQUIRED') is False: return False
    if any(marker in upper for marker in EXCLUDED_TITLE_MARKERS): return False
    if number in CANONICAL_PC01_ISSUES or _flag(body, 'PC01_REQUIRED') is True: return True
    if '[PC01' in upper or upper.startswith('PC01 ') or ' PC01 ' in f' {upper} ': return True
    if re.search(r'(?im)^\s*Executor\s*$[\s\S]{0,160}?\bPC01\b', body): return True
    if re.search(r'(?im)^\s*Source\s*$[\s\S]{0,100}?pc01-runtime-required', body): return True
    return False


def list_jobs():
    raw = gh('issue', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,body,url')
    jobs = [row for row in json.loads(raw or '[]') if (JOB_MARKER in (row.get('body') or '') or COMMAND_MARKER in (row.get('body') or '')) and job_is_pc01(row)]
    return sorted(jobs, key=lambda row: (0 if 'P0' in ((row.get('title') or '') + '\n' + (row.get('body') or '')).upper() else 1, int(row.get('number') or 0)))


def issue_state(number): return json.loads(gh('issue', 'view', str(number), '--repo', REPO, '--json', 'state,stateReason') or '{}')
def comment(number, body):
    safe = redact(body)
    if _contains_sensitive(safe): safe = f'{PUBLIC_EVIDENCE_SUPPRESSED}\ntime={now()}'
    gh('issue', 'comment', str(number), '--repo', REPO, '--body', safe)
def close_issue(number): gh('issue', 'close', str(number), '--repo', REPO)
def instruction_from(body): return body.split('## Instruction', 1)[1].strip() if '## Instruction' in body else body.replace(JOB_MARKER, '').strip()
def body_key(job): return f"{job['number']}:{hashlib.sha256((job.get('body') or '').encode()).hexdigest()[:16]}"


def validate_ai_action(obj):
    if not isinstance(obj, dict): raise ValueError('tool request must be object')
    action = obj.get('action')
    if action not in AI_ACTIONS: raise ValueError(f'action not allowed: {action}')
    if {'argv', 'command', 'cmd', 'shell', 'executable', 'path', 'content'}.intersection(obj): raise ValueError('raw command/file access is forbidden')
    if action in {'task_status', 'task_start', 'task_stop'} and str(obj.get('task', '')).strip() not in ALLOWED_TASKS: raise ValueError('task not allowlisted')
    return action


def dispatch_ai_tool(obj):
    action = validate_ai_action(obj)
    fixed = {
        'repo_status': ('repo.status', {}), 'pc01_status': ('pc01.runtime.status', {}),
        'tailscale_status': ('tailscale.status', {}), 'tailscale_ipv4': ('tailscale.ipv4', {}),
        'listener_status': ('listener.status', {'port': 8790}), 'workforce_build': ('workforce.controller.build', {}),
        'workforce_start': ('workforce.controller.ensure', {}), 'workforce_status': ('workforce.controller.status', {}),
        'ollama_status': ('ollama.status', {}),
    }
    if action in fixed:
        name, args = fixed[action]; return execute_control_command({'action': name, 'args': args})
    if action == 'repo_test': return execute_control_command({'action': 'repo.test', 'args': {'script': str(obj.get('script', '')).strip()}})
    if action in {'task_status', 'task_start', 'task_stop'}:
        name = {'task_status':'tigeriq.task.status','task_start':'tigeriq.task.start','task_stop':'tigeriq.task.stop'}[action]
        return execute_control_command({'action': name, 'args': {'task': str(obj.get('task', '')).strip()}})
    if action == 'finish': return {'finish': True, 'summary': redact(obj.get('summary', ''))}
    raise ValueError('unsupported action')


def ollama_chat(model, messages, json_mode=False, timeout=None):
    if not model: raise RuntimeError('model not configured')
    payload = {'model': model, 'messages': messages, 'stream': False, 'options': {'temperature': 0, 'num_ctx': 32768}}
    if json_mode: payload['format'] = 'json'
    req = urllib.request.Request(OLLAMA + '/api/chat', data=json.dumps(payload).encode(), headers={'Content-Type':'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout or MODEL_TIMEOUT) as response: data = json.loads(response.read().decode())
    return data['message']['content'].strip()


def model_identities():
    models = {'executor': EXECUTOR_MODEL, 'reviewer': REVIEWER_MODEL, 'judge': JUDGE_MODEL}
    if not all(models.values()): return None
    try:
        with urllib.request.urlopen(urllib.request.Request(OLLAMA + '/api/tags', method='GET'), timeout=min(MODEL_TIMEOUT, 30)) as response: data = json.loads(response.read().decode())
    except Exception as exc:
        append_audit({'event':'model_identity_probe_failed','error':f'{type(exc).__name__}: {exc}'}); return None
    catalog = {}
    for row in data.get('models', []):
        match = DIGEST_RE.match(str(row.get('digest', '')).strip().lower())
        if not match: continue
        for key in (row.get('name'), row.get('model')):
            if key: catalog[str(key).strip()] = match.group(1).lower()
    identities = {role:{'model':model,'digest':catalog.get(model)} for role, model in models.items()}
    return identities if all(v['digest'] for v in identities.values()) else None


def model_independence_ready(identities=None):
    identities = identities if identities is not None else model_identities()
    if not identities or set(identities) != {'executor','reviewer','judge'}: return False
    digests = [identities[r].get('digest') for r in ('executor','reviewer','judge')]
    return all(digests) and len(set(digests)) == 3


def acquire_lease(state, number, key):
    lease = state['leases'].get(str(number))
    if lease:
        try: expiry = datetime.fromisoformat(lease['expires_at'])
        except Exception: expiry = now_dt() - timedelta(seconds=1)
        if expiry > now_dt(): return False
    state['leases'][str(number)] = {'key':key,'claimed_at':now(),'heartbeat_at':now(),'expires_at':(now_dt()+timedelta(seconds=LEASE_SECONDS)).isoformat()}
    save_state(state); return True


def heartbeat(state, number, step):
    lease = state['leases'].get(str(number))
    if not lease: return
    lease['heartbeat_at'] = now(); lease['expires_at'] = (now_dt()+timedelta(seconds=LEASE_SECONDS)).isoformat(); save_state(state)
    if step in (1,4,8,12,16): comment(number, f'{HEARTBEAT}\ntime={now()}\nstep={step}/{MAX_STEPS}')


def execute_ai_tools(instruction, deadline, state, number):
    system = ('PC01 Secure Worker V3. No shell, argv, PowerShell, arbitrary executable, file read/write, credentials, MAIN/Production, Web or Android changes. '
              'Return one JSON object using only: repo_status, repo_test(script=approved fixed test), pc01_status, tailscale_status, tailscale_ipv4, '
              'listener_status, workforce_build, workforce_start, workforce_status, task_status/task_start/task_stop(task=allowlisted TigerIQ task), ollama_status, finish(summary).')
    messages=[{'role':'system','content':system},{'role':'user','content':instruction}]; trace=[]
    for step in range(1,MAX_STEPS+1):
        if time.monotonic() >= deadline: return {'summary':'WO_EXECUTOR_DEADLINE_EXCEEDED','trace':trace[-12:]}
        heartbeat(state, number, step)
        raw = ollama_chat(EXECUTOR_MODEL, messages, json_mode=True, timeout=min(MODEL_TIMEOUT,max(10,int(deadline-time.monotonic()))))
        try: obj=json.loads(raw); result=dispatch_ai_tool(obj)
        except Exception as exc: obj=None; result={'error':f'{type(exc).__name__}: {exc}'}
        trace.append({'step':step,'action':obj.get('action') if isinstance(obj,dict) else 'invalid','ok':not bool(result.get('error')) if isinstance(result,dict) else False})
        if isinstance(result,dict) and result.get('finish'): return {'summary':redact(result.get('summary','')),'trace':trace[-12:]}
        messages.extend([{'role':'assistant','content':raw},{'role':'user','content':'TOOL_RESULT '+json.dumps(sanitize_value(result),ensure_ascii=False)}])
    return {'summary':'WO_EXECUTOR_BLOCKED: maximum tool steps reached','trace':trace[-12:]}


def parse_pass(raw):
    try: obj=json.loads(raw); return bool(obj.get('pass')),redact(obj.get('reason',''))
    except Exception: return False,'invalid reviewer/judge JSON'


def execute_command_job(job):
    command=parse_command_body(job.get('body') or '')
    if not command: return False
    number=int(job['number']); result=execute_control_once(number,command)
    if result.get('replayed'):
        append_audit({'event':'command_replay_skipped','issue':number,'action':command.get('action')}); return True
    comment(number,f'{CLAIM}\nPC01 deterministic claim at {now()}\nmode=secure-v3-command')
    comment(number,(DONE if result.get('ok') else FAILED)+'\n```json\n'+public_json({'timestamp':now(),'worker':'pc01','mode':'secure-v3-command','result':result})+'\n```')
    append_audit({'event':'command_result','issue':number,'ok':bool(result.get('ok')),'action':command.get('action')})
    if result.get('ok') and issue_state(number).get('state')=='OPEN': close_issue(number)
    return bool(result.get('ok'))


def execute_ai_job(job,state):
    number=int(job['number']); key=body_key(job); attempt=int(state['attempts'].get(key,0))
    if attempt>=MAX_RETRIES: return False
    identities=model_identities()
    if not model_independence_ready(identities):
        if attempt==0: comment(number,f'{NEEDS_REVIEW}\nSecure V3 requires three distinct immutable local Ollama model digests for AI jobs.')
        state['attempts'][key]=MAX_RETRIES; save_state(state); return False
    if not acquire_lease(state,number,key): return False
    state['attempts'][key]=attempt+1; save_state(state); instruction=instruction_from(job.get('body') or '')
    comment(number,f'{CLAIM}\nPC01 claimed at {now()}\nmode=secure-v3-typed-tools\nattempt={attempt+1}/{MAX_RETRIES}')
    executor=execute_ai_tools(instruction,time.monotonic()+JOB_DEADLINE,state,number)
    review_raw=ollama_chat(REVIEWER_MODEL,[{'role':'system','content':'Independent reviewer. JSON only: {"pass":true|false,"reason":"..."}.'},{'role':'user','content':json.dumps({'instruction':redact(instruction),'executor_result':executor},ensure_ascii=False)}],json_mode=True)
    review_pass,review_reason=parse_pass(review_raw)
    judge_raw=ollama_chat(JUDGE_MODEL,[{'role':'system','content':'Independent judge. DONE needs runtime evidence and reviewer PASS. JSON only: {"pass":true|false,"reason":"..."}.'},{'role':'user','content':json.dumps({'instruction':redact(instruction),'executor_result':executor,'review_pass':review_pass,'review_reason':review_reason},ensure_ascii=False)}],json_mode=True)
    judge_pass,judge_reason=parse_pass(judge_raw); after=model_identities(); stable=model_independence_ready(after) and after==identities; passed=review_pass and judge_pass and stable
    evidence={'timestamp':now(),'worker':'pc01','mode':'secure-v3-typed-tools','models':identities,'model_identity_stable':stable,'attempt':attempt+1,'executor':executor,'review':{'pass':review_pass,'reason':review_reason},'judge':{'pass':judge_pass,'reason':judge_reason}}
    comment(number,(DONE if passed else FAILED)+'\n```json\n'+public_json(evidence)+'\n```'); state['leases'].pop(str(number),None)
    if passed:
        state['done']=sorted(set(state['done'])|{str(number)},key=int)
        if issue_state(number).get('state')=='OPEN': close_issue(number)
    save_state(state); return passed


def main():
    if not acquire_instance_lock(): print(f'{now()} DUPLICATE_WORKER_BLOCKED',flush=True); return 9
    print(f'{now()} TIGERIQ PC01 SECURE WORKER V3 ONLINE repo={REPO}',flush=True)
    while True:
        try:
            state=load_state()
            for job in list_jobs():
                if COMMAND_MARKER in (job.get('body') or ''): execute_command_job(job); continue
                if str(job['number']) in set(state.get('done',[])): continue
                execute_ai_job(job,state)
        except Exception as exc:
            append_audit({'event':'worker_error','error':f'{type(exc).__name__}: {exc}'})
            print(f'{now()} WORKER ERROR {type(exc).__name__}: {redact(exc)}',flush=True)
        time.sleep(POLL_SECONDS)


if __name__=='__main__': raise SystemExit(main() or 0)
