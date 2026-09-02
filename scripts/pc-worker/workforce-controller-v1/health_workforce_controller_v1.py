from __future__ import annotations

import json
import shutil
import subprocess
import urllib.request
from pathlib import Path

EXPECTED_IP = "100.97.23.87"
PORT = 8790
TASK = "TigerIQ Workforce Controller"


def _exe(name: str, fallback: str) -> str:
    value = shutil.which(name)
    if value:
        return value
    if Path(fallback).exists():
        return fallback
    raise RuntimeError(f"{name} unavailable")


def _run(argv: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, text=True, capture_output=True, timeout=timeout, encoding="utf-8", errors="replace")


def tailscale_check() -> dict:
    exe = _exe("tailscale", r"C:\Program Files\Tailscale\tailscale.exe")
    result = _run([exe, "ip", "-4"])
    rows = sorted(set(x.strip() for x in result.stdout.splitlines() if x.strip())) if result.returncode == 0 else []
    return {"ok": rows == [EXPECTED_IP], "ipv4": rows[0] if len(rows) == 1 else None}


def listener_check() -> dict:
    exe = _exe("netstat", r"C:\Windows\System32\netstat.exe")
    result = _run([exe, "-ano", "-p", "tcp"])
    listeners = []
    if result.returncode == 0:
        for raw in result.stdout.splitlines():
            line = raw.strip()
            if not line.upper().startswith("TCP") or "LISTENING" not in line.upper():
                continue
            parts = line.split()
            if len(parts) < 5:
                continue
            local = parts[1]
            host, sep, port_text = local.rpartition(":")
            host = host.strip("[]")
            if sep and port_text == str(PORT):
                listeners.append({"address": host, "pid": int(parts[4]) if parts[4].isdigit() else None})
    wildcard = any(x["address"] in {"0.0.0.0", "::"} for x in listeners)
    exact = [x for x in listeners if x["address"] == EXPECTED_IP]
    other = [x for x in listeners if x["address"] != EXPECTED_IP]
    return {"ok": len(exact) == 1 and not wildcard and not other, "listeners": listeners, "wildcard": wildcard}


def task_check() -> dict:
    exe = _exe("schtasks", r"C:\Windows\System32\schtasks.exe")
    result = _run([exe, "/Query", "/TN", TASK, "/FO", "LIST", "/V"])
    return {"ok": result.returncode == 0, "exists": result.returncode == 0}


def http_check() -> dict:
    url = f"http://{EXPECTED_IP}:{PORT}/api/v1/status"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            body = json.loads(response.read(256000).decode("utf-8"))
            return {"ok": response.status == 200 and body.get("ok") is True and body.get("postgres") is True, "httpStatus": int(response.status), "postgres": bool(body.get("postgres")), "version": body.get("version")}
    except Exception as exc:
        return {"ok": False, "httpStatus": None, "error": type(exc).__name__}


def main() -> int:
    ts = tailscale_check()
    listener = listener_check()
    task = task_check()
    http = http_check() if ts["ok"] and listener["ok"] else {"ok": False, "httpStatus": None, "skipped": True}
    ok = ts["ok"] and listener["ok"] and task["ok"] and http["ok"]
    print(json.dumps({"ok": ok, "action": "workforce.controller.v1.health", "expectedBind": f"{EXPECTED_IP}:{PORT}", "tailscale": ts, "listener": listener, "scheduledTask": task, "http": http}, separators=(",", ":")))
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
