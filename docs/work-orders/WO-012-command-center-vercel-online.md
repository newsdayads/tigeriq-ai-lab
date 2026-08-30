# WO-012 — TigerIQ AI Web Control Online

## Objective
Run TigerIQ AI Web Control as an isolated Vercel project linked only to `newsdayads/tigeriq-ai-lab`, without modifying or linking to the Tiger IQ Driver Vercel project/repository.

## Production architecture
Browser → Vercel static chat UI → Vercel Function `/api/control` → GitHub REST API → durable TigerIQ issue queue/evidence.

PC01 is an execution worker behind the online control plane. PC01/OpenClaw/Ollama availability does not block the online UI; unavailable execution capabilities are reported as offline/unknown rather than fabricated.

## Production evidence — 2026-08-30
- Production project: `tigeriq-ai-lab`.
- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- Repository: `newsdayads/tigeriq-ai-lab` only.
- Production deployment for commit `c72521cff674803fa8335e3c80de5b9493b9f506`: `READY`.
- `/api/control` public status: HTTP 200.
- Verified snapshot: Vercel `online`, GitHub `online`, PC01 `offline`, OpenClaw `unknown`, Ollama `unknown`.
- Open queue currently includes PC01 control-plane issues #57 and #58.
- UI is Vietnamese, chat-first, mobile-first, branded `TigerIQ AI`, with floating reload and collapsed technical settings.
- Tiger IQ Driver repository/project remains untouched.

## Authorization model
Read-only status and informational chat do not require a secret.

Write operations require GitHub authorization. Supported paths:
1. Browser-scoped fine-grained GitHub token supplied in `x-tigeriq-github-token`; token is kept only in browser session storage and is not committed or persisted by Vercel.
2. Optional server-side `TIGERIQ_GITHUB_TOKEN` + `TIGERIQ_COMMAND_SECRET` if configured later.

Recommended browser token scope:
- Resource owner: `newsdayads`.
- Repository access: only `tigeriq-ai-lab`.
- Repository permission: `Issues — Read and write` only.
- Short expiry preferred.

## Security gates
- No secrets in repository.
- No Tiger IQ Driver repository/project mutation.
- No public arbitrary shell or Windows execution endpoint.
- GitHub write credential is never returned in API responses.
- Web Control emits bounded TigerIQ Work Order / deterministic canary issue formats only.
- PC01/OpenClaw/Ollama state is evidence-derived; no fabricated online state.

## Acceptance gates
1. Vercel deployment linked to `newsdayads/tigeriq-ai-lab` only — PASS.
2. Production root serves TigerIQ AI UI — PASS.
3. `/api/control` GET returns live status without credentials — PASS.
4. Status reports Vercel/GitHub online and truthful PC01/OpenClaw/Ollama states — PASS.
5. Informational chat works without GitHub write authorization — IMPLEMENTED.
6. Work Order creation through Web Control creates exactly one GitHub issue — WAITING one-time GitHub write authorization on the user's browser.
7. Canary creation emits valid `TIGERIQ_COMMAND_V1` JSON for `system.status` — IMPLEMENTED; runtime write gate waits on the same GitHub authorization.
8. Tiger IQ Driver production remains unchanged — PASS.
9. PC01 consumes a Web Control-created command and returns claim/result evidence — FAIL/EXTERNAL EXECUTION BLOCKER; PC01 worker ingress remains offline.

## Current state
Web Control online/read path is production-ready. The only external UI action remaining for Web Control write-path verification is one-time GitHub authorization with minimum Issues permission. PC01 execution remediation is a separate workstream and does not block online control-plane availability.
