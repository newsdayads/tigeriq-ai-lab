import importlib
import json
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


def expect_action_denied(payload):
    try:
        worker.validate_ai_action(payload)
    except ValueError:
        return
    raise AssertionError(f'payload should be denied: {payload!r}')


def expect_read_denied(path):
    try:
        worker.tool_read(path)
    except ValueError:
        return
    raise AssertionError(f'read should be denied: {path}')


def expect_write_denied(path):
    try:
        worker.tool_write(path, 'blocked')
    except ValueError:
        return
    raise AssertionError(f'write should be denied: {path}')


# Build a fake tracked repository. Local/untracked files deliberately coexist to prove
# the AI cannot read a normal-looking credential/config file merely because it is in WORKSPACE.
tracked_content = {
    'README.md': 'TigerIQ public readme\n',
    'apps/demo/source.txt': 'tracked app source\n',
    'docs/guide.md': 'tracked documentation\n',
    'scripts/tool.py': 'print("tracked helper")\n',
    '.github/workflows/ci.yml': 'name: protected workflow\n',
    'scripts/pc-worker/worker_secure_v3.py': 'protected worker boundary\n',
}
for rel, content in tracked_content.items():
    target = workspace / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')

(workspace / '.git').mkdir(parents=True, exist_ok=True)
(workspace / '.git' / 'config').write_text('https://user:password@example.invalid/repo\n', encoding='utf-8')
(workspace / 'apps' / 'local-config.json').write_text('{"private_key":"LOCAL_ONLY"}', encoding='utf-8')
(workspace / '.netrc').write_text('machine example login user password value', encoding='utf-8')

worker._TRACKED_CACHE = {path.lower() for path in tracked_content}
worker.AI_CREATED_FILES.clear()

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
    expect_action_denied(payload)

assert worker.validate_ai_action({'action': 'list', 'path': '.'}) == 'list'
assert worker.validate_ai_action({'action': 'read', 'path': 'README.md'}) == 'read'
assert worker.validate_ai_action({'action': 'write', 'path': 'scratch/output.txt', 'content': 'ok'}) == 'write'
assert worker.validate_ai_action({'action': 'repo_status'}) == 'repo_status'
assert worker.validate_ai_action({'action': 'repo_test', 'script': 'python scripts/pc-worker/test_control_plane_v2.py'}) == 'repo_test'

# Explicit read scope: harmless tracked source works; protected, sensitive and untracked local files do not.
assert worker.tool_read('README.md')['content'] == 'TigerIQ public readme\n'
assert worker.tool_read('apps/demo/source.txt')['content'] == 'tracked app source\n'
for path in (
    '.git/config',
    '.github/workflows/ci.yml',
    'scripts/pc-worker/worker_secure_v3.py',
    'apps/local-config.json',
    '.netrc',
    '../outside.txt',
):
    expect_read_denied(path)

root_entries = {row['name'].lower() for row in worker.tool_list('.')['entries']}
assert 'readme.md' in root_entries
assert 'apps' in root_entries
assert '.git' not in root_entries
assert '.github' not in root_entries
script_entries = {row['name'].lower() for row in worker.tool_list('scripts')['entries']}
assert 'tool.py' in script_entries
assert 'pc-worker' not in script_entries

# AI cannot self-modify the worker/security boundary or workflow execution surface, and it cannot
# overwrite a pre-existing untracked local file even when the directory itself is writable.
for path in (
    'scripts/pc-worker/worker_secure_v3.py',
    '.github/workflows/evil.yml',
    '.git/config',
    '../outside.txt',
    'config/secrets.txt',
    '.env',
    'apps/local-config.json',
):
    expect_write_denied(path)

result = worker.tool_write('scratch/output.txt', 'hello')
assert result['bytes'] == 5
assert len(result['sha256']) == 64
assert worker.tool_read('scratch/output.txt')['content'] == 'hello'

# Public evidence must redact common secret forms and tool-trace metadata must never carry raw read content.
secret_samples = (
    'Authorization: Bearer abc.def.ghi',
    'Basic dXNlcjpwYXNz',
    'password: supersecret',
    'https://user:pass@example.com/path',
    '{"private_key":"DO_NOT_PRINT"}',
    'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
    'AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
    'sk-abcdefghijklmnopqrstuvwxyz123456',
    '-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----',
)
for sample in secret_samples:
    safe = worker.redact(sample)
    for forbidden in ('abc.def.ghi', 'dXNlcjpwYXNz', 'supersecret', 'user:pass', 'DO_NOT_PRINT', 'ABCDEF'):
        assert forbidden not in safe
    assert not worker._contains_sensitive(safe), safe

read_result = {
    'content': 'TOP_SECRET_FILE_CONTENT',
    'path': 'apps/demo/source.txt',
    'bytes': 23,
    'sha256': 'a' * 64,
    'truncated': False,
}
meta = worker._public_tool_metadata(3, {'action': 'read', 'path': 'apps/demo/source.txt'}, read_result)
serialized_meta = json.dumps(meta)
assert 'TOP_SECRET_FILE_CONTENT' not in serialized_meta
assert meta['sha256'] == 'a' * 64

public = worker.public_json({'password': 'supersecret', 'private_key': 'DO_NOT_PRINT'})
assert 'supersecret' not in public
assert 'DO_NOT_PRINT' not in public
assert not worker._contains_sensitive(public)

# Distinct role names are insufficient. Immutable Ollama digests must resolve and be distinct.
worker.EXECUTOR_MODEL = 'exec:latest'
worker.REVIEWER_MODEL = 'review:latest'
worker.JUDGE_MODEL = 'judge:latest'
original_catalog = worker.ollama_model_catalog
try:
    worker.ollama_model_catalog = lambda: {
        'exec:latest': '1' * 64,
        'review:latest': '1' * 64,
        'judge:latest': '2' * 64,
    }
    same_digest = worker.model_identities()
    assert worker.model_independence_ready(same_digest) is False

    worker.ollama_model_catalog = lambda: {
        'exec:latest': '1' * 64,
        'review:latest': '2' * 64,
        'judge:latest': '3' * 64,
    }
    distinct = worker.model_identities()
    assert worker.model_independence_ready(distinct) is True
    assert distinct['executor']['digest'] == '1' * 64
finally:
    worker.ollama_model_catalog = original_catalog

worker.REVIEWER_MODEL = ''
worker.JUDGE_MODEL = ''
assert worker.model_independence_ready() is False

print('WORKER_SECURE_V3_TEST_PASS')
