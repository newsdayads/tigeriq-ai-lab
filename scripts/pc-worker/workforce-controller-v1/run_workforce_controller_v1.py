from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

EXPECTED_IP = "100.97.23.87"
PORT = "8790"
DEFAULT_DSN_FILE = Path(r"F:\TigerIQ\Secrets\postgres-workforce.dsn")
DEFAULT_ADMIN_FILE = Path(r"F:\TigerIQ\Secrets\workforce-controller-v1-admin.secret")


def resolve_tailscale() -> str:
    candidates = [shutil.which("tailscale"), r"C:\Program Files\Tailscale\tailscale.exe"]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return str(Path(candidate).resolve())
    raise RuntimeError("tailscale.exe unavailable")


def tailscale_ipv4() -> str:
    result = subprocess.run([resolve_tailscale(), "ip", "-4"], text=True, capture_output=True, timeout=15, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError("Tailscale IPv4 lookup failed")
    rows = sorted(set(x.strip() for x in result.stdout.splitlines() if x.strip()))
    if rows != [EXPECTED_IP]:
        raise RuntimeError(f"PC01 Tailscale IPv4 mismatch: expected {EXPECTED_IP}")
    return rows[0]


def read_nonempty(path: Path, label: str) -> str:
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        raise RuntimeError(f"{label} file is empty")
    return value


def main() -> int:
    base = Path(__file__).resolve().parent
    host = tailscale_ipv4()
    dsn_file = Path(os.environ.get("TIGERIQ_POSTGRES_DSN_FILE", str(DEFAULT_DSN_FILE)))
    admin_file = Path(os.environ.get("TIGERIQ_WORKFORCE_ADMIN_SECRET_FILE", str(DEFAULT_ADMIN_FILE)))
    dsn = read_nonempty(dsn_file, "PostgreSQL DSN")
    if len(read_nonempty(admin_file, "admin secret")) < 32:
        raise RuntimeError("admin secret is too short")

    os.environ["TIGERIQ_POSTGRES_DSN"] = dsn
    os.environ["TIGERIQ_WORKFORCE_HOST"] = host
    os.environ["TIGERIQ_WORKFORCE_PORT"] = PORT
    os.environ["TIGERIQ_WORKFORCE_ADMIN_SECRET_FILE"] = str(admin_file)
    os.environ["TIGERIQ_WORKFORCE_SCHEMA"] = str(base / "workforce_controller_v1.sql")
    os.environ.setdefault("TIGERIQ_WORKFORCE_AUTO_MIGRATE", "0")

    from workforce_controller_v1 import main as controller_main
    return controller_main()


if __name__ == "__main__":
    raise SystemExit(main())
