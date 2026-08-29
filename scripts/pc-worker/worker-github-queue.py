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
MARKER = 'TIGERIQ_JOB_V1'
CLAIM = 'TIGERIQ_PC01_CLAIMED'
DONE = 'TIGERIQ_PC01_DONE'
FAILED = 'TIGERIQ_PC01_FAILED'


def now():
    return datetime.now(timezone.utc).isoformat()


def gh(*args):
    p = subprocess.run(['gh', *args], text=True, capture_output=True, encoding='utf-8')
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
    payload = {
        'model': MODEL,
        'messages': messages,
        'stream': False,
        'options': {'temperature': 0, 'num_ctx': 65536},
    }
    if json_mode:
        payload['format'] = 'json'
    req = urllib.request.Request(
        OLLAMA + '/api/chat',
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read().decode('utf-8'))
    return data['message']['content'].strip()


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
        comment(number, f'{CLAIM}\nPC01 claimed at {now()}\nmodel={MODEL}')

    executor = ollama_chat([
        {'role': 'system', 'content': 'You are pc01-coder. Execute the requested TigerIQ work safely. Do not claim actions you cannot perform. Return a concise result with evidence and any blocker.'},
        {'role': 'user', 'content': instruction},
    ])

    reviewer_raw = ollama_chat([
        {'role': 'system', 'content': 'You are pc01-reviewer, independent from the coder. Review whether the result actually addresses the instruction, avoids unsupported claims, and is safe. Return JSON only: {"pass":true|false,"reason":"..."}.'},
        {'role': 'user', 'content': json.dumps({'instruction': instruction, 'executor_result': executor}, ensure_ascii=False)},
    ], json_mode=True)
    review_pass, review_reason = parse_pass(reviewer_raw)

    judge_raw = ollama_chat([
        {'role': 'system', 'content': 'You are pc01-judge, independent from coder and reviewer. Gate DONE only if the instruction is satisfied and reviewer passed. Return JSON only: {"pass":true|false,"reason":"..."}.'},
        {'role': 'user', 'content': json.dumps({'instruction': instruction, 'executor_result': executor, 'review_pass': review_pass, 'review_reason': review_reason}, ensure_ascii=False)},
    ], json_mode=True)
    judge_pass, judge_reason = parse_pass(judge_raw)

    evidence = {
        'timestamp': now(),
        'worker': 'pc01',
        'provider': 'ollama',
        'model': MODEL,
        'executor': executor,
        'review': {'pass': review_pass, 'reason': review_reason},
        'judge': {'pass': judge_pass, 'reason': judge_reason},
    }
    if review_pass and judge_pass:
        comment(number, DONE + '\n```json\n' + json.dumps(evidence, ensure_ascii=False, indent=2) + '\n```')
        close_issue(number)
        return True
    comment(number, FAILED + '\n```json\n' + json.dumps(evidence, ensure_ascii=False, indent=2) + '\n```')
    return False


def main():
    state = load_state()
    done = set(state.get('done', []))
    print(f'{now()} TIGERIQ GITHUB QUEUE WORKER ONLINE repo={REPO} model={MODEL}', flush=True)
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
