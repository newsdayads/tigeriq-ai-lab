from __future__ import annotations

import importlib.util
import pathlib
import sys

BASE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("wcv1", BASE / "workforce_controller_v1.py")
MOD = importlib.util.module_from_spec(SPEC)
sys.modules["wcv1"] = MOD
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MOD)


class MemoryStore:
    def __init__(self):
        self.employees = {}
        self.devices = {}
        self.jobs = {}
        self.prompts = {}
        self.leases = {}
        self.evidence = []
        self.results = {}
    def ping(self): return True
    def create_employee(self, r): self.employees[r["employeeId"]] = dict(r); return dict(r)
    def list_employees(self): return list(self.employees.values())
    def create_device(self, r): self.devices[r["deviceId"]] = dict(r); return {k:v for k,v in r.items() if k != "tokenSha256"}
    def authenticate_device(self, device_id, token): return device_id in self.devices and MOD.safe_equal_digest(token, self.devices[device_id]["tokenSha256"])
    def heartbeat(self, device_id, r): return {"device": {"deviceId": device_id, "status": r["status"]}, "heartbeat": {"ok": True}}
    def create_job(self, r):
        existing = next((x for x in self.jobs.values() if x["idempotencyKey"] == r["idempotencyKey"]), None)
        if existing: return existing
        self.jobs[r["jobId"]] = dict(r, status="queued"); return self.jobs[r["jobId"]]
    def append_prompt(self, job_id, r): self.prompts.setdefault(job_id, []).append(dict(r)); return dict(r, jobId=job_id)
    def lease_job(self, device_id, employee_id, ttl_seconds):
        job = next((x for x in self.jobs.values() if x["employeeId"] == employee_id and x["status"] == "queued"), None)
        if not job: return None
        job["status"] = "leased"; token = "lease-token-value"; lease = {"leaseId":"lease-1","jobId":job["jobId"],"deviceId":device_id,"employeeId":employee_id,"leaseToken":token,"prompts":self.prompts.get(job["jobId"],[])}; self.leases["lease-1"] = dict(lease); return lease
    def accept_result(self, device_id, job_id, lease_id, r):
        if r["leaseToken"] != "lease-token-value": raise PermissionError("invalid_lease_token")
        self.jobs[job_id]["status"] = "completed"; self.results[job_id] = dict(r); return {"jobId":job_id,"resultId":r["resultId"]}
    def append_evidence(self, device_id, job_id, lease_id, r):
        if r["leaseToken"] != "lease-token-value": raise PermissionError("invalid_lease_token")
        self.evidence.append(dict(r)); return {"jobId":job_id,"evidenceId":r["evidenceId"]}
    def status(self): return {"employees":len(self.employees),"devices":len(self.devices),"queued_jobs":sum(1 for x in self.jobs.values() if x["status"]=="queued"),"active_leases":sum(1 for x in self.jobs.values() if x["status"]=="leased")}


def admin(): return {"x-tigeriq-admin-secret":"A"*40}


def run():
    assert MOD.validate_bind("100.97.23.87") == "100.97.23.87"
    for unsafe in ["0.0.0.0", "::", "127.0.0.1", "192.168.1.20", "100.97.23.88"]:
        try: MOD.validate_bind(unsafe); raise AssertionError(f"accepted unsafe bind {unsafe}")
        except ValueError: pass

    store = MemoryStore(); c = MOD.Controller(store, "A"*40)
    code, body = c.handle("GET","/api/v1/status",{},{}); assert code == 200 and body["postgres"] is True
    code, _ = c.handle("POST","/api/v1/employees",admin(),{"employeeId":"EMP-001","displayName":"Employee 1","department":"AI","role":"worker","provider":"gemini","model":"gemini","capabilities":["reasoning"]}); assert code == 201
    code, dev = c.handle("POST","/api/v1/devices",admin(),{"deviceId":"PHONE-001","kind":"android","platform":"Android","agentVersion":"1.0","capabilities":["gemini"]}); assert code == 201
    token = dev["credential"]["token"]; assert token and dev["credential"]["returnedOnce"] is True
    dh = {"x-tigeriq-device-id":"PHONE-001","authorization":f"Bearer {token}"}
    code, _ = c.handle("POST","/api/v1/devices/PHONE-001/heartbeat",dh,{"status":"online","metrics":{"batteryPct":80}}); assert code == 200
    code, job = c.handle("POST","/api/v1/jobs",admin(),{"idempotencyKey":"JOB-001-KEY","jobId":"JOB-001","employeeId":"EMP-001","priority":10,"requirements":{"provider":"gemini"}}); assert code == 201 and job["job"]["jobId"] == "JOB-001"
    code, job2 = c.handle("POST","/api/v1/jobs",admin(),{"idempotencyKey":"JOB-001-KEY","jobId":"SHOULD-NOT-WIN","employeeId":"EMP-001","priority":10}); assert job2["job"]["jobId"] == "JOB-001"
    code, prompt = c.handle("POST","/api/v1/jobs/JOB-001/prompts",admin(),{"sequence":0,"role":"user","content":"Do the task"}); assert code == 201 and len(prompt["prompt"]["contentSha256"]) == 64
    code, leased = c.handle("POST","/api/v1/jobs/lease",dh,{"employeeId":"EMP-001","ttlSeconds":300}); assert code == 200 and leased["lease"]["jobId"] == "JOB-001"
    lease = leased["lease"]
    code, _ = c.handle("POST","/api/v1/jobs/JOB-001/evidence",dh,{"leaseId":lease["leaseId"],"leaseToken":lease["leaseToken"],"kind":"text","sha256":"a"*64}); assert code == 201
    code, res = c.handle("POST","/api/v1/jobs/JOB-001/result",dh,{"leaseId":lease["leaseId"],"leaseToken":lease["leaseToken"],"employeeId":"EMP-001","provider":"gemini","model":"m","output":{"text":"ok"},"attempts":1,"errors":[],"timestamps":{"startedAt":"x","finishedAt":"y"}}); assert code == 200 and res["result"]["jobId"] == "JOB-001"
    try: c.handle("POST","/api/v1/jobs",{},{}); raise AssertionError("admin auth bypass")
    except PermissionError: pass
    try: c.handle("POST","/api/v1/jobs/lease",{"x-tigeriq-device-id":"PHONE-001","authorization":"Bearer wrong"},{"employeeId":"EMP-001"}); raise AssertionError("device auth bypass")
    except PermissionError: pass

    installer = (BASE / "install-workforce-controller-v1.ps1").read_text(encoding="utf-8")
    assert "100.97.23.87" in installer and "8790" in installer and "100.64.0.0/10" in installer
    assert "0.0.0.0" not in installer and "checkout main" not in installer.lower() and "pull --ff-only" not in installer.lower()
    assert "TigerIQ Workforce Controller" in installer and "RestartCount 10" in installer and "MultipleInstances IgnoreNew" in installer
    assert "postgres-workforce.dsn" in installer and "StartNow" in installer
    controller = (BASE / "workforce_controller_v1.py").read_text(encoding="utf-8")
    forbidden = ["os.system(", "shell=True", "subprocess.Popen(", "eval(", "exec("]
    assert not any(x in controller for x in forbidden)
    sql = (BASE / "workforce_controller_v1.sql").read_text(encoding="utf-8")
    for table in ["workforce_employee","workforce_device","workforce_job","workforce_lease","workforce_heartbeat","workforce_result","workforce_evidence","workforce_prompt"]: assert f"CREATE TABLE IF NOT EXISTS {table}" in sql
    print("WORKFORCE_CONTROLLER_V1_TEST_PASS")


if __name__ == "__main__": run()
