import json
import os
import tempfile
from pathlib import Path

root = Path(tempfile.mkdtemp())
os.environ['TIGERIQ_WORKSPACE'] = str(root / 'workspace')
os.environ['TIGERIQ_WORKER_DIR'] = str(root / 'worker')
os.environ['TIGERIQ_CONTROL_STATE'] = str(root / 'state.json')
os.environ['TIGERIQ_CONTROL_AUDIT'] = str(root / 'audit.jsonl')
os.environ['TIGERIQ_WORKFORCE_JOURNAL'] = str(root / 'state' / 'workforce.jsonl')

import control_plane_v2 as cp

Path(os.environ['TIGERIQ_WORKSPACE']).mkdir(parents=True, exist_ok=True)

cmd = cp.parse_command_body('TIGERIQ_COMMAND_V1\n```json\n{"idempotency_key":"t1","action":"system.status","args":{}}\n```')
assert cmd['action'] == 'system.status'
assert cp.execute_command(cmd)['ok'] is True

for bad in ('main', 'wo010/command-center-web-control'):
    try:
        cp.execute_command({'action':'repo.fetch','args':{'branch':bad}})
        raise AssertionError('branch should be denied: ' + bad)
    except ValueError:
        pass

try:
    cp.execute_command({'action':'tigeriq.task.start','args':{'task':'Anything Else'}})
    raise AssertionError('non-allowlisted task should be denied')
except ValueError:
    pass

try:
    cp.execute_command({'action':'listener.status','args':{'port':8789}})
    raise AssertionError('non-8790 listener probe should be denied')
except ValueError:
    pass

assert cp._is_tailnet_ipv4('100.64.0.1')
assert cp._is_tailnet_ipv4('100.127.255.254')
assert not cp._is_tailnet_ipv4('100.128.0.1')
assert not cp._is_tailnet_ipv4('0.0.0.0')

original_run = cp._run
original_tail = cp._tailscale_exe
original_netstat = cp._netstat_exe
try:
    cp._tailscale_exe = lambda: 'tailscale'
    cp._run = lambda argv, **kwargs: {'returncode':0,'stdout':'100.97.23.87\n','stderr':''} if argv[1:]==['ip','-4'] else {'returncode':0,'stdout':json.dumps({'BackendState':'Running','Self':{'Online':True,'TailscaleIPs':['100.97.23.87']}}),'stderr':''}
    assert cp.tailscale_ipv4() == '100.97.23.87'
    assert cp.tailscale_status()['ok'] is True

    cp._netstat_exe = lambda: 'netstat'
    cp._run = lambda argv, **kwargs: {'returncode':0,'stdout':'  TCP    100.97.23.87:8790    0.0.0.0:0    LISTENING    1234\n','stderr':''}
    ls = cp.listener_status()
    assert ls['ok'] is True and ls['wildcard_listener'] is False
    assert ls['listeners'][0]['address'] == '100.97.23.87'

    cp._run = lambda argv, **kwargs: {'returncode':0,'stdout':'  TCP    0.0.0.0:8790    0.0.0.0:0    LISTENING    1234\n','stderr':''}
    ls = cp.listener_status()
    assert ls['ok'] is False and ls['wildcard_listener'] is True
finally:
    cp._run = original_run
    cp._tailscale_exe = original_tail
    cp._netstat_exe = original_netstat

state = cp.load_state()
lease = cp.acquire_lease(state, 1, 'idem-1')
assert lease['status'] == 'acquired'
cp.finish(state, 1, 'idem-1', {'ok': True, 'action':'system.status'})
replay = cp.acquire_lease(cp.load_state(), 1, 'idem-1')
assert replay['status'] == 'completed'
print('CONTROL_PLANE_V2_TEST_PASS')
