# TigerIQ Worker Utility V1

Native Windows utility for NV02/NV03/NV04. It keeps the real Chrome windows and adds small native worker badges plus a 280–350px control popup. No badge DOM injection is used.

Control path: `Worker Utility -> ChromeController 8798 -> Direct CDP Bridge 8799 -> worker`.

Safety gates:
- Session mismatch => BLOCKED.
- auth/CAPTCHA/security/rate-limit => fail closed.
- Save & Archive requires DURABLE receipt.
- Safe Close rejects active job/UI mutation.
- Safe Recover never force-kills Chrome.
- Position operations only move/focus; no reload.
- Watchdog separates alive heartbeat from progress and escalates at 30s/2m/5m with cooldown.

Persistent state is stored under `%LOCALAPPDATA%\TigerIQ\WorkerUtility\state.json`; logs are JSONL beside it. Autostart uses the current-user Run key.

Build: `dotnet build apps/worker-utility/TigerIQ.WorkerUtility.csproj -c Release`.
Self-test: `TigerIQ.WorkerUtility.exe --self-test`.
Publish: `dotnet publish apps/worker-utility/TigerIQ.WorkerUtility.csproj -c Release -o artifact/worker-utility`.

Rollback: exit only `TigerIQ.WorkerUtility.exe`, remove its Run-key entry, then start the previous Worker Utility artifact if one exists. Never stop Chrome/ChromeController as part of Utility rollback.