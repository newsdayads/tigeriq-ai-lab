import json
import os
import tempfile
from pathlib import Path

root = Path(tempfile.mkdtemp())
os.environ['TIGERIQ_WORKSPACE'] = str(root / 'workspace')
os.environ['TIGERIQ_CONTROL_STATE'] = str(root / 'state.json')
os.environ['TIGERIQ_CONTROL_AUDIT'] = str(root / 'audit.jsonl')

from control_plane_v2 import acquire_lease, execute_command, finish, load_state, parse_command_body

Path(os.environ['TIGERIQ_WORKSPACE']).mkdir(parents=True, exist_ok=True)

cmd = parse_command_body('TIGERIQ_COMMAND_V1\n```json\n{"idempotency_key":"t1","action":"system.status","args":{}}\n```')
assert cmd['action'] == 'system.status'
assert execute_command(cmd)['ok'] is True

try:
    execute_command({'action':'repo.fetch','args':{'branch':'main'}})
    raise AssertionError('main fetch should be denied')
except ValueError:
    pass

try:
    execute_command({'action':'tigeriq.task.start','args':{'task':'Anything Else'}})
    raise AssertionError('non-allowlisted task should be denied')
except ValueError:
    pass

state = load_state()
lease = acquire_lease(state, 1, 'idem-1')
assert lease['status'] == 'acquired'
finish(state, 1, 'idem-1', {'ok': True})
state2 = load_state()
replay = acquire_lease(state2, 1, 'idem-1')
assert replay['status'] == 'completed'
assert replay['result']['ok'] is True

print('CONTROL_PLANE_V2_TEST_PASS')
