from __future__ import annotations

import pathlib

import workforce_controller_v1 as base
from workforce_controller_recovery_v1 import RecoveryController, RecoveryPostgresStore, install_recovery_patch

BASE = pathlib.Path(__file__).resolve().parent


class LeaseMemoryStore:
    def __init__(self):
        self.token = base.digest_secret("device-token")
    def ping(self): return True
    def status(self): return {"employees":1,"devices":1,"queued_jobs":0,"active_leases":1}
    def authenticate_device(self, device_id, token): return device_id == "PHONE-001" and base.safe_equal_digest(token, self.token)
    def renew_lease(self, device_id, job_id, lease_id, lease_token, ttl_seconds):
        if lease_token != "lease-token": raise PermissionError("invalid_lease_token")
        return {"leaseId":lease_id,"jobId":job_id,"deviceId":device_id,"status":"active","ttlSeconds":ttl_seconds}
    def create_employee(self, record): raise AssertionError
    def list_employees(self): return []
    def create_device(self, record): raise AssertionError
    def heartbeat(self, device_id, record): raise AssertionError
    def create_job(self, record): raise AssertionError
    def append_prompt(self, job_id, record): raise AssertionError
    def lease_job(self, device_id, employee_id, ttl_seconds): raise AssertionError
    def accept_result(self, device_id, job_id, lease_id, record): raise AssertionError
    def append_evidence(self, device_id, job_id, lease_id, record): raise AssertionError


def run():
    store = LeaseMemoryStore()
    controller = RecoveryController(store, "A"*40)
    headers = {"x-tigeriq-device-id":"PHONE-001","authorization":"Bearer device-token"}
    code, body = controller.handle("POST","/api/v1/jobs/JOB-001/lease/heartbeat",headers,{"leaseId":"LEASE-001","leaseToken":"lease-token","ttlSeconds":300})
    assert code == 200 and body["lease"]["status"] == "active"
    try:
        controller.handle("POST","/api/v1/jobs/JOB-001/lease/heartbeat",headers,{"leaseId":"LEASE-001","leaseToken":"lease-token","ttlSeconds":901})
        raise AssertionError("lease ttl cap bypass")
    except ValueError:
        pass

    source = (BASE / "workforce_controller_recovery_v1.py").read_text(encoding="utf-8")
    assert "FOR UPDATE SKIP LOCKED" in source
    assert "status='expired'" in source and "SET status='queued'" in source
    assert "ON CONFLICT(evidence_id)" in source
    assert "SELECT result_id,job_id,lease_id,device_id" in source
    assert "shell=True" not in source and "os.system(" not in source and "subprocess" not in source

    runner = (BASE / "run_workforce_controller_v1.py").read_text(encoding="utf-8")
    assert "install_recovery_patch()" in runner
    installer = (BASE / "install-workforce-controller-v1.ps1").read_text(encoding="utf-8")
    assert "workforce_controller_recovery_v1.py" in installer
    assert "RepetitionInterval (New-TimeSpan -Minutes 5)" in installer
    assert "MultipleInstances IgnoreNew" in installer

    old_store = base.PostgresStore
    old_controller = base.Controller
    install_recovery_patch()
    assert base.PostgresStore is RecoveryPostgresStore and base.Controller is RecoveryController
    base.PostgresStore = old_store
    base.Controller = old_controller
    print("WORKFORCE_CONTROLLER_V1_RECOVERY_TEST_PASS")


if __name__ == "__main__":
    run()
