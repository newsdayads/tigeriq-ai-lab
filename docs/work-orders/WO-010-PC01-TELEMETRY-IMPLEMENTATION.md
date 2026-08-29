# WO-010 PC01 Telemetry Implementation Contract

Current branch already contains `scripts/pc-worker/pc01-telemetry.ps1` as the safe Windows collector.

Implementation requirements:
1. Add a read-only `/api/server` endpoint to Command Center. It must execute the collector with bounded timeout, parse JSON, and fail closed to a safe unavailable payload.
2. Render a Server/PC01 panel on desktop and mobile showing CPU, RAM, uptime, disk, worker state/PID, Ollama state/models, Tailscale state/IP, and GPU only when available.
3. Do not expose command secret, cookies, headers, prompts, job bodies, private profile data or arbitrary process command lines.
4. Add a compact current-activity label using safe runtime state only; if exact active job cannot be proven, say `Chưa xác định` rather than infer.
5. Preserve local/private bind, CSP/security headers, write auth, CSRF and idempotency behavior.
6. Add tests for `/api/server` success, collector failure/unavailable, HTML escaping/safe rendering, no-secret behavior, and mobile presence.
7. CI must PASS. Independent review must review exact SHA, not `HEAD~1`.

## Operational path change
TigerIQ Command Center is now the primary operational and reporting surface. Trello is removed from the default execution critical path.

Work Orders MUST NOT wait for Trello card creation, card movement, checklist updates, or Trello reporting before execution, review, judge, evidence recording, or completion.

Default runtime path:
Owner → Command Center → Model Router / PC01 → Execution → Independent Review → Judge/Gate → Evidence/State → Command Center Owner Report.

Trello is optional only for archive/compatibility when explicitly requested.
