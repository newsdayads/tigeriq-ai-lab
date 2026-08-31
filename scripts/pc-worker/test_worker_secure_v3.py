import importlib
import os
import tempfile
from pathlib import Path

root = Path(tempfile.mkdtemp())
workspace = root / 'workspace'
workspace.mkdir(parents=True, exist_ok=True)
os.environ['TIGERIQ_WORKSPACE'] = str(workspace)
os.environ['TIGERIQ_QUEUE_STATE'] = str(root / 'queue-state.json')
os.environ['TIGERIQ_WORKER_AUDIT'] = str(root / 'worker-audit.jsonl')
os.environ['TIGERIQ_CONTROL_STATE'] = str(root / 'control-state.json')
os.environ['TIGERIQ_CONTROL_AUDIT'] = str(root / 'control-audit.jsonl')
os.environ['TIGERIQ_REVIEWER_MODEL'] = ''
os.environ['TIGERIQ_JUDGE_MODEL'] = ''

worker = importlib.import_module('worker_secure_v3')


def expect_denied(payload):
    try:
        worker.validate_ai_action(payload)
    except ValueError:
        return
    raise AssertionError(f'payload should be denied: {payload!r}')


# Regression: generic shell/interpreter/package-runner vectors must not exist in the AI tool surface.
for payload in (
    {'action': 'run', 'argv': ['cmd', '/c', 'echo', 'BYPASS']},
    {'action': 'run', 'argv': ['python', '-c', "print('BYPASS')"]},
    {'action': 'run', 'argv': ['py', '-c', "print('BYPASS')"]},
    {'action': 'run', 'argv': ['node', '-e', "console.log('BYPASS')"]},
    {'action': 'run', 'argv': ['npm', 'exec', '--', 'anything']},
    {'action': 'run', 'argv': ['npx', 'anything']},
    {'action': 'run', 'argv': ['powershell.exe', '-Command', 'Write-Output BYPASS']},
    {'action': 'repo_status', 'argv': ['git', 'status']},
    {'action': 'read', 'command': 'type secret.txt'},
):
    expect_denied(payload)

assert worker.validate_ai_action({'action': 'list', 'path': '.'}) == 'list'
assert worker.validate_ai_action({'action': 'read', 'path': 'README.md'}) == 'read'
assert worker.validate_ai_action({'action': 'write', 'path': 'scratch/output.txt', 'content': 'ok'}) == 'write'
assert worker.validate_ai_action({'action': 'repo_status'}) == 'repo_status'
assert worker.validate_ai_action({'action': 'repo_test', 'script': 'python scripts/pc-worker/test_control_plane_v2.py'}) == 'repo_test'

# AI cannot self-modify the worker/security boundary or workflow execution surface.
for path in (
    'scripts/pc-worker/worker_secure_v3.py',
    '.github/workflows/evil.yml',
    '.git/config',
    '../outside.txt',
    'config/secrets.txt',
    '.env',
):
    try:
        worker.tool_write(path, 'blocked')
    except ValueError:
        pass
    else:
        raise AssertionError(f'protected/sensitive path should be denied: {path}')

result = worker.tool_write('scratch/output.txt', 'hello')
assert result['bytes'] == 5
assert worker.tool_read('scratch/output.txt')['content'] == 'hello'
assert worker.model_independence_ready() is False

print('WORKER_SECURE_V3_TEST_PASS')
