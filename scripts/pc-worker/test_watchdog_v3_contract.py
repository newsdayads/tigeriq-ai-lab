from pathlib import Path

script = (Path(__file__).parent / 'worker-watchdog-v3.ps1').read_text(encoding='utf-8')
lower = script.lower()

required = (
    'global\\tigeriqworkerwatchdogv3',
    'get-ciminstance win32_process',
    'start-scheduledtask',
    'duplicates_removed',
    'worker_recovered',
    'watchdog-v3.jsonl',
    'waitone(0)',
)
for marker in required:
    assert marker in lower, f'missing watchdog contract marker: {marker}'

for forbidden in (
    'invoke-expression',
    'invoke-webrequest',
    'downloadstring',
    'start-bitstransfer',
    'set-executionpolicy',
    'new-pssession',
    'enter-pssession',
    'winrm',
    'netsh',
    'set-netfirewall',
    'remove-item -recurse',
    'format-volume',
    'shutdown.exe',
):
    assert forbidden not in lower, f'forbidden watchdog behavior present: {forbidden}'

# The watchdog may inspect the fixed worker command line only to count the expected process.
assert '$_.commandline -match $escaped' in lower
assert 'authorization' not in lower
assert 'cookie' not in lower
assert 'token=' not in lower
assert 'password=' not in lower

print('WATCHDOG_V3_CONTRACT_TEST_PASS')
