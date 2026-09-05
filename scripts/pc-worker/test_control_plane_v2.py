import json
import os
import tempfile
import urllib.error
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


class FakeResponse:
    def __init__(self, status, payload):
        self.status = status
        self._body = json.dumps(payload).encode('utf-8')

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, _limit):
        return self._body


original_ipv4 = cp.tailscale_ipv4
original_listener = cp.listener_status
original_urlopen = cp.urllib.request.urlopen
try:
    cp.tailscale_ipv4 = lambda: '100.97.23.87'
    cp.listener_status = lambda port=cp.WORKFORCE_PORT: {
        'ok': True,
        'action': 'listener.status',
        'port': cp.WORKFORCE_PORT,
        'listeners': [{'address':'100.97.23.87','pid':1234}],
        'wildcard_listener': False,
        'public_listener': [],
    }
    seen_urls = []

    def good_urlopen(url, timeout=5):
        seen_urls.append(url)
        assert timeout == 5
        return FakeResponse(200, {
            'ok': True,
            'protocol': 'controller-v1',
            'postgres': True,
            'migration': '001_operational_state_v1',
        })

    cp.urllib.request.urlopen = good_urlopen
    status = cp.workforce_status()
    assert status['ok'] is True
    assert status['contract_ok'] is True
    assert seen_urls == ['http://100.97.23.87:8790/api/v1/status']

    for payload in (
        {'ok': True, 'protocol': 'wrong-controller', 'postgres': True, 'migration': '001_operational_state_v1'},
        {'ok': False, 'protocol': 'controller-v1', 'postgres': True, 'migration': '001_operational_state_v1'},
        {'ok': True, 'protocol': 'controller-v1', 'postgres': False, 'migration': '001_operational_state_v1'},
        {'ok': True, 'protocol': 'controller-v1', 'postgres': True, 'migration': 'unexpected'},
    ):
        cp.urllib.request.urlopen = lambda url, timeout=5, payload=payload: FakeResponse(200, payload)
        status = cp.workforce_status()
        assert status['ok'] is False and status['contract_ok'] is False

    def not_found(url, timeout=5):
        raise urllib.error.HTTPError(url, 404, 'Not Found', hdrs=None, fp=None)

    cp.urllib.request.urlopen = not_found
    status = cp.workforce_status()
    assert status['ok'] is False and status['http_status'] == 404
finally:
    cp.tailscale_ipv4 = original_ipv4
    cp.listener_status = original_listener
    cp.urllib.request.urlopen = original_urlopen

state = cp.load_state()
lease = cp.acquire_lease(state, 1, 'idem-1')
assert lease['status'] == 'acquired'
cp.finish(state, 1, 'idem-1', {'ok': True, 'action':'system.status'})
replay = cp.acquire_lease(cp.load_state(), 1, 'idem-1')
assert replay['status'] == 'completed'
print('CONTROL_PLANE_V2_TEST_PASS')