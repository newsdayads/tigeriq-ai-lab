# TigerIQ Runtime OpenClaw plugin

OpenClaw tools for PC01:

- `tigeriq_runtime`: bounded Core + Chrome Controller operations.
- `tigeriq_pc`: guarded local PC operator for TigerIQ/OpenClaw runtime maintenance.

`tigeriq_pc` supports:
- exact `TigerIQ ...` Scheduled Task status/start/stop/restart;
- process listing and allowlisted local TCP probes;
- text file read/write/list/stat inside `D:\TigerIQ`, `D:\OpenClaw`, and `D:\TigerIQ-OpenClaw`;
- a strict diagnostic shell allowlist for read-only Git/OpenClaw/Ollama inspection.

Guardrails:
- no arbitrary shell;
- child processes do not inherit TigerIQ/API/token environment variables;
- blocks TigerIQ Secrets, browser profile/session stores, SSH/system credential paths;
- blocks writes to the canonical TigerIQ repository, runtime CoreSource, and `.git`;
- real-path containment checks block junction/symlink escapes for file actions;
- no file delete action;
- no Production deploy/publish or direct main/master mutation through this tool;
- shell timeout <= 120s; file sizes and output are bounded.

Repository engineering remains GitHub/Coding Lane authority. This plugin is a PC01 runtime operator, not a replacement source-code lane.
