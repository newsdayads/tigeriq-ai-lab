import json
import os
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = os.getenv('TIGERIQ_REPO', 'newsdayads/tigeriq-ai-lab')
MODEL = os.getenv('TIGERIQ_OLLAMA_MODEL', 'qwen2.5-coder:14b')
OLLAMA = os.getenv('TIGERIQ_OLLAMA_URL', 'http://127.0.0.1:11434')
POLL_SECONDS = int(os.getenv('TIGERIQ_POLL_SECONDS', '30'))
STATE_PATH = Path(os.getenv('TIGERIQ_QUEUE_STATE', r'F:\TigerIQ\Worker\queue-state.json'))
WORKSPACE = Path(os.getenv('TIGERIQ_WORKSPACE', r'F:\TigerIQ\Workspace\tigeriq-ai-lab'))
MARKER = 'TIGERIQ_JOB_V1'
CLAIM = 'TIGERIQ_PC01_CLAIMED'
DONE = 'TIGERIQ_PC01_DONE'
FAILED = 'TIGERIQ_PC01_FAILED'
MAX_STEPS = int(os.getenv('TIGERIQ_AGENT_MAX_STEPS', '40'))
MAX_OUTPUT = 12000
ALLOWED_EXE = {'git','gh','python','py','node','npm','npx','cmd'}
BLOCKED_FRAGMENTS = (
    'git push origin main', 'git push origin master', 'git push --force',
    'git reset --hard', 'git clean -fd', 'gh pr merge', 'gh repo delete',
    'gh secret ', 'del /s', 'rmdir /s', 'format ', 'shutdown ', 'restart-computer'
)

def now():
    return datetime.now(timezone.utc).isoformat()

def gh(*args):
    p = subprocess.run(['gh', *args], text=True, capture_output=True, encoding='utf-8', errors='replace')
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip())
    return p.stdout

def load_state():
    try:
        return json.loads(STATE_PATH.read_text(encoding='utf-8'))
    except Exception:
        return {'done': []}

def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(STATE_PATH)

def issue_comments(number):
    owner, repo = REPO.split('/', 1)
    raw = gh('api', f'repos/{owner}/{repo}/issues/{number}/comments', '--paginate')
    return json.loads(raw or '[]')

def comment(number, body):
    gh('issue', 'comment', str(number), '--repo', REPO, '--body', body)

def close_issue(number):
    gh('issue', 'close', str(number), '--repo', REPO)

def list_jobs():
    raw = gh('issue', 'list', '--repo', REPO, '--state', 'open', '--limit', '100', '--json', 'number,title,body,url')
    return [x for x in json.loads(raw or '[]') if MARKER in (x.get('body') or '')]

def instruction_from(body):
    if '## Instruction' in body:
        return body.split('## Instruction', 1)[1].strip()
    return body.replace(MARKER, '').strip()

def ollama_chat(messages, json_mode=False):
    payload = {'model': MODEL, 'messages': messages, 'stream': False, 'options': {'temperature': 0, 'num_ctx': 65536}}
    if json_mode:
        payload['format'] = 'json'
    req = urllib.request.Request(OLLAMA + '/api/chat', data=json.dumps(payload).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read().decode('utf-8'))
    return data['message']['content'].strip()

def ensure_workspace():
    WORKSPACE.parent.mkdir(parents=True, exist_ok=True)
    if not (WORKSPACE / '.git').exists():
        p = subprocess.run(['git','clone',f'https://github.com/{REPO}.git',str(WORKSPACE)], text=True, capture_output=True, encoding='utf-8', errors='replace')
        if p.returncode != 0:
            raise RuntimeError((p.stderr or p.stdout).strip())
    subprocess.run(['git','fetch','--all','--prune'], cwd=WORKSPACE, text=True, capture_output=True, encoding='utf-8', errors='replace')

def safe_path(value):
    p = (WORKSPACE / value).resolve() if not Path(value).is_absolute() else Path(value).resolve()
    root = WORKSPACE.resolve()
    if p != root and root not in p.parents:
        raise ValueError('path outside workspace')
    return p

def redact(text):
    if not text:
        return ''
    lowered = text.lower()
    for marker in ('authorization:', 'cookie:', 'api_key=', 'api-key=', 'token=', 'password='):
        if marker in lowered:
            return '[REDACTED SENSITIVE OUTPUT]'
    return text[-MAX_OUTPUT:]

def run_command(argv, timeout=180):
    if not isinstance(argv, list) or not argv or not all(isinstance(x, str) for x in argv):
        raise ValueError('argv must be a non-empty string list')
    exe = Path(argv[0]).name.lower()
    if exe not in ALLOWED_EXE:
        raise ValueError(f'executable not allowed: {exe}')
    joined = ' '.join(argv).lower()
    if any(x in joined for x in BLOCKED_FRAGMENTS):
        raise ValueError('blocked destructive/privileged command')
    if exe == 'git' and len(argv) >= 2 and argv[1] == 'checkout' and any(x in ('main','master') for x in argv[2:]):
        raise ValueError('direct checkout of main/master is blocked for write jobs')
    p = subprocess.run(argv, cwd=WORKSPACE, text=True, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout)
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
    rows = []
    for child in sorted(p.iterdir(), key=lambda x: x.name.lower())[:200]:
        rows.append({'name': child.name, 'type': 'dir' if child.is_dir() else 'file'})
    return {'entries': rows}

def parse_json(text):
    try:
        return json.loads(text)
    except Exception:
        return None

def execute_with_tools(instruction):
    ensure_workspace()
    system = '''You are PC01 coding executor with real bounded tools. You MUST perform repository work when requested and must never claim an action without tool evidence. Return ONE JSON object each turn with exactly one action: {"action":"read","path":"relative/path"} {"action":"list","path":"relative/path"} {"action":"write","path":"relative/path","content":"full UTF-8 file content"} {"action":"run","argv":["git","status","--short"],"timeout":180} {"action":"finish","summary":"concise evidence-backed result"}. Rules: work only inside the TigerIQ workspace; never merge or push main/master; never expose secrets; prefer feature branches and draft PRs; inspect before writing; run tests; include exact commit SHA/PR/CI evidence before claiming PASS. If blocked, finish with concrete blocker and evidence.'''
    messages = [{'role':'system','content':system}, {'role':'user','content':instruction}]
    trace = []
    for step in range(1, MAX_STEPS + 1):
        raw = ollama_chat(messages, json_mode=True)
        obj = parse_json(raw)
        if not isinstance(obj, dict):
            result = {'error':'invalid tool JSON', 'raw': raw[:1000]}
        else:
            action = obj.get('action')
            try:
                if action == 'read': result = tool_read(obj.get('path',''))
                elif action == 'list': result = tool_list(obj.get('path','.'))
                elif action == 'write': result = tool_write(obj.get('path',''), obj.get('content',''))
                elif action == 'run': result = run_command(obj.get('argv'), int(obj.get('timeout',180)))
                elif action == 'finish':
                    summary = str(obj.get('summary','')).strip()
                    return summary + '\n\nTOOL TRACE SUMMARY:\n' + '\n'.join(trace[-12:])
                else: result = {'error': f'unknown action: {action}'}
            except Exception as e:
                result = {'error': f'{type(e).__name__}: {e}'}
        trace.append(f"step={step} action={obj.get('action') if isinstance(obj,dict) else 'invalid'} result={json.dumps(result, ensure_ascii=False)[:1200]}")
        messages.append({'role':'assistant','content':raw})
        messages.append({'role':'user','content':'TOOL_RESULT '+json.dumps(result, ensure_ascii=False)})
    return 'WO_EXECUTOR_BLOCKED: maximum tool steps reached\n' + '\n'.join(trace[-12:])

def parse_pass(text):
    try:
        obj = json.loads(text)
        return bool(obj.get('pass')), str(obj.get('reason', ''))
    except Exception:
        return False, 'invalid reviewer/judge JSON'

def execute_job(job):
    number = job['number']
    body = job.get('body') or ''
    instruction = instruction_from(body)
    comments = issue_comments(number)
    comment_text = '\n'.join((x.get('body') or '') for x in comments)
    if DONE in comment_text:
        return True
    if CLAIM not in comment_text:
        comment(number, f'{CLAIM}\nPC01 claimed at {now()}\nmodel={MODEL}\nmode=bounded-tools')
    executor = execute_with_tools(instruction)
    reviewer_raw = ollama_chat([{'role':'system','content':'You are pc01-reviewer, independent from coder. Review only evidence in executor result. Reject unsupported claims. Return JSON only: {"pass":true|false,"reason":"..."}.'},{'role':'user','content':json.dumps({'instruction':instruction,'executor_result':executor}, ensure_ascii=False)}], json_mode=True)
    review_pass, review_reason = parse_pass(reviewer_raw)
    judge_raw = ollama_chat([{'role':'system','content':'You are pc01-judge, independent from coder/reviewer. DONE requires instruction satisfied, concrete evidence, and reviewer PASS. Return JSON only: {"pass":true|false,"reason":"..."}.'},{'role':'user','content':json.dumps({'instruction':instruction,'executor_result':executor,'review_pass':review_pass,'review_reason':review_reason}, ensure_ascii=False)}], json_mode=True)
    judge_pass, judge_reason = parse_pass(judge_raw)
    evidence = {'timestamp': now(), 'worker':'pc01', 'provider':'ollama', 'model':MODEL, 'mode':'bounded-tools', 'executor':executor, 'review':{'pass':review_pass,'reason':review_reason}, 'judge':{'pass':judge_pass,'reason':judge_reason}}
    marker = DONE if review_pass and judge_pass else FAILED
    comment(number, marker + '\n```json\n' + json.dumps(evidence, ensure_ascii=False, indent=2) + '\n```')
    if review_pass and judge_pass:
        close_issue(number)
        return True
    return False

def main():
    state = load_state()
    done = set(state.get('done', []))
    print(f'{now()} TIGERIQ GITHUB QUEUE WORKER ONLINE repo={REPO} model={MODEL} mode=bounded-tools', flush=True)
    while True:
        try:
            for job in list_jobs():
                key = str(job['number'])
                if key in done:
                    continue
                if execute_job(job):
                    done.add(key)
                    state['done'] = sorted(done, key=lambda x: int(x))
                    save_state(state)
        except Exception as e:
            print(f'{now()} WORKER ERROR {type(e).__name__}: {e}', flush=True)
        time.sleep(POLL_SECONDS)

if __name__ == '__main__':
    main()
