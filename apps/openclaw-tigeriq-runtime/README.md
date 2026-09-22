# TigerIQ Runtime OpenClaw plugin

A single bounded OpenClaw tool, `tigeriq_runtime`, for PC01 runtime operations. Core uses the canonical PC01 Tailscale address; Chrome Controller remains loopback-only.

Allowed surfaces:
- TigerIQ Core `GET /api/status`
- TigerIQ Core `POST /api/objectives`
- Chrome Controller `GET /api/state`
- Existing allowlisted Chrome worker/global actions

Security properties:
- Core HTTP is restricted to the canonical PC01 Core host `100.97.23.87:8795` (loopback remains accepted for local recovery/tests);
- Chrome Controller remains loopback-only on `127.0.0.1:8798`;
- no shell/exec primitive;
- no arbitrary file access;
- no credential/session-store reads;
- bounded request timeouts;
- compact/redacted runtime output.

Repository engineering remains GitHub/Coding Lane only. This plugin is a runtime operator, not a source-code executor.

OpenClaw 2026.9.2 plugin packaging follows the native tool-plugin contract: built JavaScript entry, `openclaw.plugin.json`, and `package.json#openclaw.extensions`.
