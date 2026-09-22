# TigerIQ Runtime OpenClaw plugin

A single bounded OpenClaw tool, `tigeriq_runtime`, for PC01 runtime operations.

Allowed surfaces:
- TigerIQ Core `GET /api/status`
- TigerIQ Core `POST /api/objectives`
- Chrome Controller `GET /api/state`
- Existing allowlisted Chrome worker/global actions

Security properties:
- loopback HTTP only, fixed ports 8795/8798;
- no shell/exec primitive;
- no arbitrary file access;
- no credential/session-store reads;
- bounded request timeouts;
- compact/redacted runtime output.

Repository engineering remains GitHub/Coding Lane only. This plugin is a runtime operator, not a source-code executor.

OpenClaw 2026.9.2 plugin packaging follows the native tool-plugin contract: built JavaScript entry, `openclaw.plugin.json`, and `package.json#openclaw.extensions`.
