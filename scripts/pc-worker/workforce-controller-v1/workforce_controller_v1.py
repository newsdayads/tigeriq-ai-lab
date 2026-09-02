from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import signal
import sys
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol

VERSION = "1.0.0"
EXPECTED_PC01_IP = "100.97.23.87"
TAILNET = ipaddress.ip_network("100.64.0.0/10")
PORT = 8790
MAX_BODY_BYTES = 128 * 1024
SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or utcnow()).isoformat()


def validate_bind(host: str, *, expected: str = EXPECTED_PC01_IP) -> str:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError as exc:
        raise ValueError("controller bind must be a literal IPv4 address") from exc
    if ip.version != 4 or ip not in TAILNET:
        raise ValueError("controller bind must be a Tailscale IPv4 in 100.64.0.0/10")
    if host != expected:
        raise ValueError(f"controller bind must equal PC01 Tailscale IPv4 {expected}")
    return host


def digest_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def safe_equal_digest(secret: str, expected_digest: str) -> bool:
    if not secret or not expected_digest:
        return False
    return hmac.compare_digest(digest_secret(secret), expected_digest)


def require_text(value: Any, name: str, max_len: int = 512) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > max_len:
        raise ValueError(f"invalid_{name}")
    return value.strip()


def optional_text(value: Any, name: str, max_len: int = 512) -> str | None:
    if value is None:
        return None
    return require_text(value, name, max_len)


def require_dict(value: Any, name: str = "payload") -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"invalid_{name}")
    return value


def require_list(value: Any, name: str, max_items: int = 64) -> list[str]:
    if not isinstance(value, list) or len(value) > max_items:
        raise ValueError(f"invalid_{name}")
    out: list[str] = []
    for item in value:
        out.append(require_text(item, name, 128))
    return sorted(set(out))


class Store(Protocol):
    def ping(self) -> bool: ...
    def create_employee(self, record: dict[str, Any]) -> dict[str, Any]: ...
    def list_employees(self) -> list[dict[str, Any]]: ...
    def create_device(self, record: dict[str, Any]) -> dict[str, Any]: ...
    def authenticate_device(self, device_id: str, token: str) -> bool: ...
    def heartbeat(self, device_id: str, record: dict[str, Any]) -> dict[str, Any]: ...
    def create_job(self, record: dict[str, Any]) -> dict[str, Any]: ...
    def append_prompt(self, job_id: str, record: dict[str, Any]) -> dict[str, Any]: ...
    def lease_job(self, device_id: str, employee_id: str, ttl_seconds: int) -> dict[str, Any] | None: ...
    def accept_result(self, device_id: str, job_id: str, lease_id: str, record: dict[str, Any]) -> dict[str, Any]: ...
    def append_evidence(self, device_id: str, job_id: str, lease_id: str, record: dict[str, Any]) -> dict[str, Any]: ...
    def status(self) -> dict[str, Any]: ...


class PostgresStore:
    """PostgreSQL persistence boundary. No shell execution and no SQL from requests."""

    def __init__(self, dsn: str, schema_path: Path):
        if not dsn:
            raise RuntimeError("TIGERIQ_POSTGRES_DSN is required")
        self.dsn = dsn
        self.schema_path = schema_path

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError("psycopg is required for PostgreSQL runtime") from exc
        return psycopg.connect(self.dsn, row_factory=dict_row, connect_timeout=5)

    def migrate(self) -> None:
        sql = self.schema_path.read_text(encoding="utf-8")
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()

    def ping(self) -> bool:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 AS ok")
                    row = cur.fetchone()
                    return bool(row and row["ok"] == 1)
        except Exception:
            return False

    def create_employee(self, record: dict[str, Any]) -> dict[str, Any]:
        sql = """
        INSERT INTO workforce_employee(employee_id, display_name, department, role, provider, model, capabilities, status)
        VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,'idle')
        ON CONFLICT (employee_id) DO UPDATE SET
          display_name=EXCLUDED.display_name, department=EXCLUDED.department, role=EXCLUDED.role,
          provider=EXCLUDED.provider, model=EXCLUDED.model, capabilities=EXCLUDED.capabilities, updated_at=now()
        RETURNING employee_id, display_name, department, role, provider, model, capabilities, status, created_at, updated_at
        """
        params = (record["employeeId"], record["displayName"], record["department"], record["role"], record.get("provider"), record.get("model"), json.dumps(record["capabilities"]))
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                row = cur.fetchone()
            conn.commit()
        return _jsonable(row)

    def list_employees(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT employee_id, display_name, department, role, provider, model, capabilities, status, created_at, updated_at FROM workforce_employee ORDER BY employee_id")
                return [_jsonable(x) for x in cur.fetchall()]

    def create_device(self, record: dict[str, Any]) -> dict[str, Any]:
        sql = """
        INSERT INTO workforce_device(device_id, kind, platform, agent_version, capabilities, token_sha256, status)
        VALUES (%s,%s,%s,%s,%s::jsonb,%s,'online')
        ON CONFLICT (device_id) DO UPDATE SET
          kind=EXCLUDED.kind, platform=EXCLUDED.platform, agent_version=EXCLUDED.agent_version,
          capabilities=EXCLUDED.capabilities, token_sha256=EXCLUDED.token_sha256, status='online', updated_at=now()
        RETURNING device_id, kind, platform, agent_version, capabilities, status, created_at, updated_at
        """
        params = (record["deviceId"], record["kind"], record["platform"], record["agentVersion"], json.dumps(record["capabilities"]), record["tokenSha256"])
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                row = cur.fetchone()
            conn.commit()
        return _jsonable(row)

    def authenticate_device(self, device_id: str, token: str) -> bool:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT token_sha256 FROM workforce_device WHERE device_id=%s", (device_id,))
                row = cur.fetchone()
        return bool(row and safe_equal_digest(token, row["token_sha256"]))

    def heartbeat(self, device_id: str, record: dict[str, Any]) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE workforce_device SET status=%s, last_heartbeat_at=now(), agent_version=COALESCE(%s,agent_version), updated_at=now() WHERE device_id=%s RETURNING device_id,status,last_heartbeat_at,agent_version", (record["status"], record.get("agentVersion"), device_id))
                row = cur.fetchone()
                if not row:
                    raise KeyError("device_not_found")
                cur.execute("INSERT INTO workforce_heartbeat(device_id,status,metrics) VALUES(%s,%s,%s::jsonb) RETURNING heartbeat_id,created_at", (device_id, record["status"], json.dumps(record.get("metrics", {}))))
                hb = cur.fetchone()
            conn.commit()
        return {"device": _jsonable(row), "heartbeat": _jsonable(hb)}

    def create_job(self, record: dict[str, Any]) -> dict[str, Any]:
        sql = """
        INSERT INTO workforce_job(job_id, idempotency_key, employee_id, priority, requirements, status)
        VALUES(%s,%s,%s,%s,%s::jsonb,'queued')
        ON CONFLICT (idempotency_key) DO UPDATE SET updated_at=workforce_job.updated_at
        RETURNING job_id,idempotency_key,employee_id,priority,requirements,status,created_at,updated_at
        """
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (record["jobId"], record["idempotencyKey"], record["employeeId"], record["priority"], json.dumps(record.get("requirements", {}))))
                row = cur.fetchone()
            conn.commit()
        return _jsonable(row)

    def append_prompt(self, job_id: str, record: dict[str, Any]) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("INSERT INTO workforce_prompt(prompt_id,job_id,sequence,role,content_sha256,content,metadata) VALUES(%s,%s,%s,%s,%s,%s,%s::jsonb) RETURNING prompt_id,job_id,sequence,role,content_sha256,created_at", (record["promptId"], job_id, record["sequence"], record["role"], record["contentSha256"], record["content"], json.dumps(record.get("metadata", {}))))
                row = cur.fetchone()
            conn.commit()
        return _jsonable(row)

    def lease_job(self, device_id: str, employee_id: str, ttl_seconds: int) -> dict[str, Any] | None:
        lease_id = str(uuid.uuid4())
        lease_token = secrets.token_urlsafe(32)
        token_digest = digest_secret(lease_token)
        with self._connect() as conn:
            with conn.cursor() as cur:
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
        result = _jsonable(lease)
        result["leaseToken"] = lease_token
        result["prompts"] = [_jsonable(x) for x in prompts]
        return result

    def _check_lease(self, cur, device_id: str, job_id: str, lease_id: str, lease_token: str) -> dict[str, Any]:
        cur.execute("SELECT lease_id,job_id,device_id,employee_id,lease_token_sha256,expires_at,status FROM workforce_lease WHERE lease_id=%s AND job_id=%s FOR UPDATE", (lease_id, job_id))
        lease = cur.fetchone()
        if not lease or lease["device_id"] != device_id:
            raise PermissionError("lease_not_owned")
        if lease["status"] != "active" or lease["expires_at"] <= utcnow():
            raise ValueError("lease_expired")
        if not safe_equal_digest(lease_token, lease["lease_token_sha256"]):
            raise PermissionError("invalid_lease_token")
        return lease

    def accept_result(self, device_id: str, job_id: str, lease_id: str, record: dict[str, Any]) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                self._check_lease(cur, device_id, job_id, lease_id, record["leaseToken"])
                cur.execute("INSERT INTO workforce_result(result_id,job_id,lease_id,device_id,employee_id,provider,model,output,attempts,errors,timestamps) VALUES(%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s::jsonb,%s::jsonb) ON CONFLICT(job_id) DO UPDATE SET updated_at=now() RETURNING result_id,job_id,lease_id,device_id,employee_id,provider,model,attempts,created_at,updated_at", (record["resultId"], job_id, lease_id, device_id, record["employeeId"], record.get("provider"), record.get("model"), json.dumps(record["output"]), record["attempts"], json.dumps(record.get("errors", [])), json.dumps(record.get("timestamps", {}))))
                result = cur.fetchone()
                cur.execute("UPDATE workforce_lease SET status='completed', completed_at=now() WHERE lease_id=%s", (lease_id,))
                cur.execute("UPDATE workforce_job SET status='completed', completed_at=now(), updated_at=now() WHERE job_id=%s", (job_id,))
            conn.commit()
        return _jsonable(result)

    def append_evidence(self, device_id: str, job_id: str, lease_id: str, record: dict[str, Any]) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                self._check_lease(cur, device_id, job_id, lease_id, record["leaseToken"])
                cur.execute("INSERT INTO workforce_evidence(evidence_id,job_id,lease_id,device_id,kind,uri,sha256,metadata) VALUES(%s,%s,%s,%s,%s,%s,%s,%s::jsonb) RETURNING evidence_id,job_id,lease_id,device_id,kind,uri,sha256,created_at", (record["evidenceId"], job_id, lease_id, device_id, record["kind"], record.get("uri"), record["sha256"], json.dumps(record.get("metadata", {}))))
                row = cur.fetchone()
            conn.commit()
        return _jsonable(row)

    def status(self) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT (SELECT count(*) FROM workforce_employee) employees,(SELECT count(*) FROM workforce_device) devices,(SELECT count(*) FROM workforce_job WHERE status='queued') queued_jobs,(SELECT count(*) FROM workforce_lease WHERE status='active' AND expires_at>now()) active_leases")
                return _jsonable(cur.fetchone())


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


@dataclass
class AuthContext:
    kind: str
    device_id: str | None = None


class Controller:
    def __init__(self, store: Store, admin_secret: str):
        if not admin_secret:
            raise RuntimeError("admin secret is required")
        self.store = store
        self.admin_digest = digest_secret(admin_secret)

    def authorize_admin(self, headers: dict[str, str]) -> AuthContext:
        supplied = headers.get("x-tigeriq-admin-secret", "")
        if not safe_equal_digest(supplied, self.admin_digest):
            raise PermissionError("unauthorized")
        return AuthContext("admin")

    def authorize_device(self, headers: dict[str, str]) -> AuthContext:
        device_id = headers.get("x-tigeriq-device-id", "").strip()
        auth = headers.get("authorization", "")
        token = auth[7:].strip() if auth.startswith("Bearer ") else ""
        if not device_id or not token or not self.store.authenticate_device(device_id, token):
            raise PermissionError("unauthorized")
        return AuthContext("device", device_id)

    def handle(self, method: str, path: str, headers: dict[str, str], payload: dict[str, Any] | None) -> tuple[int, dict[str, Any]]:
        payload = payload or {}
        parts = [x for x in path.split("?")[0].split("/") if x]
        if method == "GET" and path.split("?")[0] in {"/api/workforce/status", "/api/v1/status"}:
            db_ok = self.store.ping()
            return (200 if db_ok else 503), {"ok": db_ok, "controller": "TigerIQ Workforce Controller V1", "version": VERSION, "postgres": db_ok, "workforce": self.store.status() if db_ok else None}

        if method == "GET" and parts == ["api", "v1", "employees"]:
            self.authorize_admin(headers)
            return 200, {"ok": True, "employees": self.store.list_employees()}

        if method == "POST" and parts == ["api", "v1", "employees"]:
            self.authorize_admin(headers)
            record = {
                "employeeId": require_text(payload.get("employeeId"), "employee_id", 128),
                "displayName": require_text(payload.get("displayName"), "display_name", 128),
                "department": require_text(payload.get("department"), "department", 128),
                "role": require_text(payload.get("role"), "role", 128),
                "provider": optional_text(payload.get("provider"), "provider", 128),
                "model": optional_text(payload.get("model"), "model", 128),
                "capabilities": require_list(payload.get("capabilities", []), "capabilities"),
            }
            return 201, {"ok": True, "employee": self.store.create_employee(record)}

        if method == "POST" and parts == ["api", "v1", "devices"]:
            self.authorize_admin(headers)
            token = secrets.token_urlsafe(32)
            record = {
                "deviceId": require_text(payload.get("deviceId"), "device_id", 128),
                "kind": require_text(payload.get("kind"), "kind", 32),
                "platform": require_text(payload.get("platform"), "platform", 128),
                "agentVersion": require_text(payload.get("agentVersion"), "agent_version", 64),
                "capabilities": require_list(payload.get("capabilities", []), "capabilities"),
                "tokenSha256": digest_secret(token),
            }
            device = self.store.create_device(record)
            return 201, {"ok": True, "device": device, "credential": {"token": token, "returnedOnce": True}}

        if method == "POST" and len(parts) == 5 and parts[:3] == ["api", "v1", "devices"] and parts[4] == "heartbeat":
            auth = self.authorize_device(headers)
            device_id = parts[3]
            if auth.device_id != device_id:
                raise PermissionError("device_mismatch")
            status = require_text(payload.get("status", "online"), "status", 32)
            if status not in {"online", "degraded", "offline"}:
                raise ValueError("invalid_status")
            record = {"status": status, "agentVersion": optional_text(payload.get("agentVersion"), "agent_version", 64), "metrics": require_dict(payload.get("metrics", {}), "metrics")}
            return 200, {"ok": True, **self.store.heartbeat(device_id, record)}

        if method == "POST" and parts == ["api", "v1", "jobs"]:
            self.authorize_admin(headers)
            record = {
                "jobId": optional_text(payload.get("jobId"), "job_id", 128) or str(uuid.uuid4()),
                "idempotencyKey": require_text(payload.get("idempotencyKey"), "idempotency_key", 128),
                "employeeId": require_text(payload.get("employeeId"), "employee_id", 128),
                "priority": int(payload.get("priority", 0)),
                "requirements": require_dict(payload.get("requirements", {}), "requirements"),
            }
            if not -100 <= record["priority"] <= 100:
                raise ValueError("invalid_priority")
            return 201, {"ok": True, "job": self.store.create_job(record)}

        if method == "POST" and len(parts) == 5 and parts[:3] == ["api", "v1", "jobs"] and parts[4] == "prompts":
            self.authorize_admin(headers)
            job_id = require_text(parts[3], "job_id", 128)
            content = require_text(payload.get("content"), "content", 65536)
            record = {
                "promptId": optional_text(payload.get("promptId"), "prompt_id", 128) or str(uuid.uuid4()),
                "sequence": int(payload.get("sequence", 0)),
                "role": require_text(payload.get("role", "user"), "role", 32),
                "content": content,
                "contentSha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                "metadata": require_dict(payload.get("metadata", {}), "metadata"),
            }
            if record["sequence"] < 0 or record["sequence"] > 10000:
                raise ValueError("invalid_sequence")
            return 201, {"ok": True, "prompt": self.store.append_prompt(job_id, record)}

        if method == "POST" and parts == ["api", "v1", "jobs", "lease"]:
            auth = self.authorize_device(headers)
            employee_id = require_text(payload.get("employeeId"), "employee_id", 128)
            ttl = int(payload.get("ttlSeconds", 300))
            if ttl < 30 or ttl > 900:
                raise ValueError("invalid_lease_ttl")
            lease = self.store.lease_job(auth.device_id or "", employee_id, ttl)
            return 200, {"ok": True, "lease": lease}

        if method == "POST" and len(parts) == 5 and parts[:3] == ["api", "v1", "jobs"] and parts[4] == "result":
            auth = self.authorize_device(headers)
            job_id = require_text(parts[3], "job_id", 128)
            lease_id = require_text(payload.get("leaseId"), "lease_id", 128)
            record = {
                "leaseToken": require_text(payload.get("leaseToken"), "lease_token", 256),
                "resultId": optional_text(payload.get("resultId"), "result_id", 128) or str(uuid.uuid4()),
                "employeeId": require_text(payload.get("employeeId"), "employee_id", 128),
                "provider": optional_text(payload.get("provider"), "provider", 128),
                "model": optional_text(payload.get("model"), "model", 128),
                "output": payload.get("output"),
                "attempts": int(payload.get("attempts", 1)),
                "errors": payload.get("errors", []),
                "timestamps": require_dict(payload.get("timestamps", {}), "timestamps"),
            }
            if record["attempts"] < 1 or record["attempts"] > 10 or not isinstance(record["errors"], list):
                raise ValueError("invalid_result")
            return 200, {"ok": True, "result": self.store.accept_result(auth.device_id or "", job_id, lease_id, record)}

        if method == "POST" and len(parts) == 5 and parts[:3] == ["api", "v1", "jobs"] and parts[4] == "evidence":
            auth = self.authorize_device(headers)
            job_id = require_text(parts[3], "job_id", 128)
            lease_id = require_text(payload.get("leaseId"), "lease_id", 128)
            sha = require_text(payload.get("sha256"), "sha256", 64).lower()
            if len(sha) != 64 or any(ch not in "0123456789abcdef" for ch in sha):
                raise ValueError("invalid_sha256")
            record = {
                "leaseToken": require_text(payload.get("leaseToken"), "lease_token", 256),
                "evidenceId": optional_text(payload.get("evidenceId"), "evidence_id", 128) or str(uuid.uuid4()),
                "kind": require_text(payload.get("kind"), "kind", 64),
                "uri": optional_text(payload.get("uri"), "uri", 2048),
                "sha256": sha,
                "metadata": require_dict(payload.get("metadata", {}), "metadata"),
            }
            return 201, {"ok": True, "evidence": self.store.append_evidence(auth.device_id or "", job_id, lease_id, record)}

        return 404, {"error": "not_found"}


class Handler(BaseHTTPRequestHandler):
    controller: Controller
    server_version = "TigerIQWorkforce/1"
    sys_version = ""

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stdout.write("%s %s\n" % (iso(), fmt % args))

    def _headers(self) -> dict[str, str]:
        return {k.lower(): v for k, v in self.headers.items()}

    def _payload(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 0 or length > MAX_BODY_BYTES:
            raise OverflowError("payload_too_large")
        if not length:
            return {}
        raw = self.rfile.read(length)
        value = json.loads(raw.decode("utf-8"))
        return require_dict(value)

    def _reply(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(_jsonable(body), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _serve(self) -> None:
        try:
            payload = self._payload() if self.command in {"POST", "PUT", "PATCH"} else {}
            status, body = self.controller.handle(self.command, self.path, self._headers(), payload)
        except OverflowError:
            status, body = 413, {"error": "payload_too_large"}
        except json.JSONDecodeError:
            status, body = 400, {"error": "invalid_json"}
        except PermissionError as exc:
            status, body = 401, {"error": str(exc)}
        except KeyError as exc:
            status, body = 404, {"error": str(exc).strip("'")}
        except ValueError as exc:
            status, body = 400, {"error": str(exc)}
        except Exception as exc:
            sys.stderr.write(f"{iso()} controller_error={type(exc).__name__}\n")
            status, body = 503, {"error": "workforce_controller_unavailable"}
        self._reply(status, body)

    do_GET = _serve
    do_POST = _serve


def read_secret(path: Path) -> str:
    secret = path.read_text(encoding="utf-8").strip()
    if len(secret) < 32:
        raise RuntimeError("admin secret file is missing or too short")
    return secret


def build_runtime() -> tuple[str, PostgresStore, Controller]:
    host = validate_bind(os.environ.get("TIGERIQ_WORKFORCE_HOST", ""))
    if int(os.environ.get("TIGERIQ_WORKFORCE_PORT", str(PORT))) != PORT:
        raise RuntimeError("Workforce Controller V1 port is fixed at 8790")
    base = Path(__file__).resolve().parent
    schema = Path(os.environ.get("TIGERIQ_WORKFORCE_SCHEMA", str(base / "workforce_controller_v1.sql"))).resolve()
    secret_path = Path(os.environ.get("TIGERIQ_WORKFORCE_ADMIN_SECRET_FILE", r"F:\TigerIQ\Secrets\workforce-controller-v1-admin.secret"))
    dsn = os.environ.get("TIGERIQ_POSTGRES_DSN", "").strip()
    store = PostgresStore(dsn, schema)
    if os.environ.get("TIGERIQ_WORKFORCE_AUTO_MIGRATE", "0") == "1":
        store.migrate()
    if not store.ping():
        raise RuntimeError("PostgreSQL readiness check failed")
    return host, store, Controller(store, read_secret(secret_path))


def main() -> int:
    host, _store, controller = build_runtime()
    Handler.controller = controller
    server = ThreadingHTTPServer((host, PORT), Handler)
    server.daemon_threads = True
    shutting_down = threading.Event()

    def stop(_signum: int, _frame: Any) -> None:
        if shutting_down.is_set():
            return
        shutting_down.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print(json.dumps({"event": "WORKFORCE_CONTROLLER_V1_START", "host": host, "port": PORT, "version": VERSION, "postgres": True}))
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
