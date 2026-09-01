import importlib, os, tempfile
from pathlib import Path
root=Path(tempfile.mkdtemp())
os.environ['TIGERIQ_QUEUE_STATE']=str(root/'queue.json'); os.environ['TIGERIQ_WORKER_AUDIT']=str(root/'audit.jsonl'); os.environ['TIGERIQ_WORKER_LOCK']=str(root/'lock')
os.environ['TIGERIQ_CONTROL_STATE']=str(root/'control.json'); os.environ['TIGERIQ_CONTROL_AUDIT']=str(root/'control-audit.jsonl'); os.environ['TIGERIQ_WORKSPACE']=str(root/'workspace'); os.environ['TIGERIQ_WORKER_DIR']=str(root/'worker')
Path(os.environ['TIGERIQ_WORKSPACE']).mkdir()
w=importlib.import_module('worker_secure_v3')
cases=[
({'number':200,'title':'Generic','body':'TIGERIQ_JOB_V1\nPC01_REQUIRED=false'},False),
({'number':201,'title':'[WEB CONTROL] dependency','body':'TIGERIQ_JOB_V1\nPC01_REQUIRED=true'},False),
({'number':202,'title':'[ANDROID] task','body':'TIGERIQ_JOB_V1\nPC01_REQUIRED=true'},False),
({'number':138,'title':'[PC01] skip','body':'TIGERIQ_JOB_V1\nPC01_REQUIRED=true'},False),
({'number':203,'title':'Generic','body':'TIGERIQ_JOB_V1\nPC01_REQUIRED=true'},True),
({'number':204,'title':'[PC01 P1] Runtime','body':'TIGERIQ_JOB_V1'},True),
({'number':133,'title':'Multi AI','body':'TIGERIQ_JOB_V1'},True),
({'number':205,'title':'Unrelated','body':'TIGERIQ_JOB_V1'},False)]
for job,expected in cases: assert w.job_is_pc01(job) is expected,job
for payload in ({'action':'run','argv':['cmd']},{'action':'repo_status','argv':['git']},{'action':'pc01_status','command':'whoami'},{'action':'read','path':'README.md'}):
    try: w.validate_ai_action(payload); raise AssertionError(payload)
    except ValueError: pass
for action in ('repo_status','repo_test','pc01_status','tailscale_status','tailscale_ipv4','listener_status','workforce_build','workforce_start','workforce_status','task_status','task_start','task_stop','ollama_status','finish'):
    obj={'action':action}
    if action.startswith('task_'): obj['task']='TigerIQ Worker'
    assert w.validate_ai_action(obj)==action
try: w.validate_ai_action({'action':'task_start','task':'Anything Else'}); raise AssertionError('bad task')
except ValueError: pass
for sample in ('Authorization: Bearer abc.def.ghi','Basic dXNlcjpwYXNz','password: supersecret','https://user:pass@example.com/path','{"private_key":"DO_NOT_PRINT"}','-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----'):
    safe=w.redact(sample)
    for bad in ('abc.def.ghi','dXNlcjpwYXNz','supersecret','user:pass','DO_NOT_PRINT','ABCDEF'): assert bad not in safe
    assert not w._contains_sensitive(safe)
assert w.model_independence_ready({'executor':{'digest':'1'*64},'reviewer':{'digest':'2'*64},'judge':{'digest':'3'*64}})
assert not w.model_independence_ready({'executor':{'digest':'1'*64},'reviewer':{'digest':'1'*64},'judge':{'digest':'3'*64}})
print('WORKER_SECURE_V3_TEST_PASS')
