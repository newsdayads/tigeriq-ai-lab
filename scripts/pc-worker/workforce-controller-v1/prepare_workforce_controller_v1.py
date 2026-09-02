from __future__ import annotations

import json
import os
from pathlib import Path

from run_workforce_controller_v1 import DEFAULT_ADMIN_FILE, DEFAULT_DSN_FILE, tailscale_ipv4, read_nonempty
from workforce_controller_v1 import PostgresStore


def main() -> int:
    base = Path(__file__).resolve().parent
    host = tailscale_ipv4()
    dsn_file = Path(os.environ.get("TIGERIQ_POSTGRES_DSN_FILE", str(DEFAULT_DSN_FILE)))
    admin_file = Path(os.environ.get("TIGERIQ_WORKFORCE_ADMIN_SECRET_FILE", str(DEFAULT_ADMIN_FILE)))
    dsn = read_nonempty(dsn_file, "PostgreSQL DSN")
    if len(read_nonempty(admin_file, "admin secret")) < 32:
        raise RuntimeError("admin secret is too short")
    store = PostgresStore(dsn, base / "workforce_controller_v1.sql")
    store.migrate()
    if not store.ping():
        raise RuntimeError("PostgreSQL readiness check failed after migration")
    print(json.dumps({"ok": True, "action": "workforce.controller.v1.prepare", "host": host, "port": 8790, "postgres": True, "schema": "ready", "secrets_exposed": False}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
