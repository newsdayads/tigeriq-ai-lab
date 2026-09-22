# TigerIQ Runtime OpenClaw plugin

OpenClaw tools for PC01:

- `tigeriq_runtime`: bounded Core + Chrome Controller operations.
- `tigeriq_pc`: guarded local PC operator with PowerShell/CMD plus workspace file read/write/list/stat.

Local operator roots:
- `D:\TigerIQ`
- `D:\OpenClaw`
- `D:\TigerIQ-OpenClaw`

Default guardrails:
- blocks TigerIQ Secrets, browser profile/session stores, SSH/system credential paths;
- blocks destructive system commands and recursive/forced deletes;
- blocks direct Production deploy/publish and direct push/merge to main/master;
- shell timeout <= 120s;
- file read/write size bounded;
- no file delete action.

This gives OpenClaw real local PC execution capability while keeping destructive/security-sensitive operations outside the default tool surface.
