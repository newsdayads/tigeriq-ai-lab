from __future__ import annotations

import json
import uuid
from typing import Any

import workforce_controller_v1 as base


class RecoveryPostgresStore(base.PostgresStore):
    """Adds bounded lease recovery and retry-safe result/evidence semantics."""

    def lease_job(self, device_id: str, employee_id: str, ttl_seconds: int) -> dict[str, Any] | None:
        lease_id = str(uuid.uuid4())
        lease_token = base.secrets.token_urlsafe(32)
        token_digest = base.digest_secret(lease_token)
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    WITH expired AS (
                      UPDATE workforce_lease SET status='expired'
                      WHERE status='active' AND expires_at <= now()
                      RETURNING job_id
                    )
                    UPDATE workforce_job SET status='queued', updated_at=now()
                    WHERE status='leased' AND job_id IN (SELECT job_id FROM expired)
                """)
                cur.execute("""
                    SELECT job_id FROM workforce_job
                    WHERE status='queued' AND employee_id=%s
                    ORDER BY priority DESC, created_at ASC
                    FOR UPDATE SKIP LOCKED LIMIT 1
                """, (employee_id,))
                job = cur.fetchone()
                if not job:
                    conn.rollback()
                    return None
                cur.execute("UPDATE workforce_job SET status='leased', updated_at=now() WHERE job_id=%s", (job["job_id"],))
                cur.execute("""
                    INSERT INTO workforce_lease(lease_id,job_id,device_id,employee_id,lease_token_sha256,expires_at,status)
                    VALUES(%s,%s,%s,%s,%s,now()+(%s * interval '1 second'),'active')
                    RETURNING lease_id,job_id,device_id,employee_id,expires_at,status,created_at
                """, (lease_id, job["job_id"], device_id, employee_id, token_digest, ttl_seconds))
                lease = cur.fetchone()
                cur.execute("SELECT prompt_id,sequence,role,content,metadata,created_at FROM workforce_prompt WHERE job_id=%s ORDER BY sequence ASC", (job["job_id"],))
                prompts = cur.fetchall()
            conn.commit()
        result = base._jsonable(lease)
        result["leaseToken"] = lease_token
        result["prompts"] = [base._jsonable(x) for x in prompts]
        return result

    def renew_lease(self, device_id: str, job_id: str, lease_id: str, lease_token: str, ttl_seconds: int) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                self._check_lease(cur, device_id, job_id, lease_id, lease_token)
                cur.execute("UPDATE workforce_lease SET expires_at=now()+(%s * interval '1 second') WHERE lease_id=%s RETURNING lease_id,job_id,device_id,employee_id,expires_at,status", (ttl_seconds, lease_id))
                row = cur.fetchone()
            conn.commit()
        return base._jsonable(row)

    def accept_result(self, device_id: str, job_id: str, lease_id: str, record: dict[str, Any]) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT result_id,job_id,lease_id,device_id,employee_id,provider,model,attempts,created_at,updated_at FROM workforce_result WHERE job_id=%s", (job_id,))
                existing = cur.fetchone()
                if existing:
                    if existing["device_id"] != device_id or existing["lease_id"] != lease_id:
                        raise PermissionError("result_already_owned")
                    conn.rollback()
                    return base._jsonable(existing)
                self._check_lease(cur, device_id, job_id, lease_id, record["leaseToken"])
                cur.execute("INSERT INTO workforce_result(result_id,job_id,lease_id,device_id,employee_id,provider,model,output,attempts,errors,timestamps) VALUES(%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s::jsonb,%s::jsonb) RETURNING result_id,job_id,lease_id,device_id,employee_id,provider,model,attempts,created_at,updated_at", (record["resultId"], job_id, lease_id, device_id, record["employeeId"], record.get("provider"), record.get("model"), json.dumps(record["output"]), record["attempts"], json.dumps(record.get("errors", [])), json.dumps(record.get("timestamps", {}))))
                result = cur.fetchone()
                cur.execute("UPDATE workforce_lease SET status='completed', completed_at=now() WHERE lease_id=%s", (lease_id,))
                cur.execute("UPDATE workforce_job SET status='completed', completed_at=now(), updated_at=now() WHERE job_id=%s", (job_id,))
            conn.commit()
        return base._jsonable(result)

    def append_evidence(self, device_id: str, job_id: str, lease_id: str, record: dict[str, Any]) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                self._check_lease(cur, device_id, job_id, lease_id, record["leaseToken"])
                cur.execute("INSERT INTO workforce_evidence(evidence_id,job_id,lease_id,device_id,kind,uri,sha256,metadata) VALUES(%s,%s,%s,%s,%s,%s,%s,%s::jsonb) ON CONFLICT(evidence_id) DO UPDATE SET evidence_id=EXCLUDED.evidence_id RETURNING evidence_id,job_id,lease_id,device_id,kind,uri,sha256,created_at", (record["evidenceId"], job_id, lease_id, device_id, record["kind"], record.get("uri"), record["sha256"], json.dumps(record.get("metadata", {}))))
                row = cur.fetchone()
            conn.commit()
        return base._jsonable(row)


class RecoveryController(base.Controller):
    def handle(self, method: str, path: str, headers: dict[str, str], payload: dict[str, Any] | None):
        payload = payload or {}
        parts = [x for x in path.split("?")[0].split("/") if x]
        if method == "POST" and len(parts) == 6 and parts[:3] == ["api", "v1", "jobs"] and parts[4:] == ["lease", "heartbeat"]:
            auth = self.authorize_device(headers)
            job_id = base.require_text(parts[3], "job_id", 128)
            lease_id = base.require_text(payload.get("leaseId"), "lease_id", 128)
            lease_token = base.require_text(payload.get("leaseToken"), "lease_token", 256)
            ttl = int(payload.get("ttlSeconds", 300))
            if ttl < 30 or ttl > 900:
                raise ValueError("invalid_lease_ttl")
            lease = self.store.renew_lease(auth.device_id or "", job_id, lease_id, lease_token, ttl)
            return 200, {"ok": True, "lease": lease}
        return super().handle(method, path, headers, payload)


def install_recovery_patch() -> None:
    base.PostgresStore = RecoveryPostgresStore
    base.Controller = RecoveryController
