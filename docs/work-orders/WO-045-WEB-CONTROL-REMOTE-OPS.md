# WO-045 — TigerIQ AI Web Control V1

## Goal
Build Web Control as the Owner-facing operating window for TigerIQ V1. The operational source of truth is the Workforce Controller on PC01; Vercel/GitHub are not the command center, scheduler, queue, or runtime state store.

## Architecture boundary
- PC01 + PostgreSQL/Workforce Controller own operational state and execution.
- Tailscale is the primary private network path from the Owner device/browser to PC01.
- Web Control is a presentation + intent client. It does not decompose goals, assign workers, select AI, lease tasks, run retries, or adjudicate results. Those responsibilities remain with the Controller / CHAT 03 / CHAT 04 / CHAT 06.
- Vercel may serve the static interface and optional Owner identity endpoint. Loss of Vercel must not stop the Controller, workers, queues, jobs, retries, or evidence pipeline.
- GitHub remains code/version/technical-evidence infrastructure only. Web V1 does not infer live job state from Issues, PRs, Actions, or deployments.

## Retained useful Web scope
- TigerIQ AI branding and responsive Web/PWA shell.
- Google Owner identity as optional UI identity. Google/Vercel identity is not Controller authorization.
- Clear status/evidence presentation with fail-closed state labels.

## Web V1 Controller contract
The browser client consumes only the contract documented at `docs/contracts/WEB_CONTROL_CONTROLLER_CONTRACT_V1.md`.

Confirmed existing Controller read endpoint:
- `GET /api/workforce/status` — aggregate workforce connectivity/status probe.

Required Controller-facing Web contract, owned outside CHAT 01:
- `GET /api/web/v1/snapshot` — authoritative complete read model.
- `POST /api/web/v1/goals` — Owner goal intent.
- `POST /api/web/v1/prompts/versions` — prompt version intent/storage contract.
- `POST /api/web/v1/jobs/:jobId/retry` — retry request intent; Controller decides eligibility/policy.

Browser Web V1 must never use `x-tigeriq-admin-secret`. The existing `POST /api/admin/tasks` endpoint is an administrative Controller endpoint and is not a browser API.

## Screens implemented with the same snapshot schema
- Company overview / JOB-001 readiness.
- Goal submission.
- Jobs / queue / stages.
- Employees / Devices.
- AI Providers / quota / health.
- Prompt Architect + prompt library/version + PASS/FAIL metrics.
- Result / Evidence / Review / Judge.
- Blocker / retry / recovery.
- Activity history.
- Controller connection settings.

## Truthfulness rules
- Mock data always reports `source.authoritative=false` and is visibly labeled MOCK.
- Mock entries must not be presented as real JOB-001, real heartbeat, real provider health, real PASS, real RUNNING, or real DONE.
- Controller mode accepts only exact schema `tigeriq.web-control.snapshot.v1` with `source.mode=controller` and `source.authoritative=true`.
- If Controller data is unavailable/invalid, Web shows unavailable/contract-pending. It must not silently fall back to GitHub/Vercel/mock and claim live state.

## Network/security rules
- Controller URL must resolve to a local/Tailscale target; public Internet Controller targets are rejected by the Web client.
- HTTPS-hosted Web cannot call an HTTP Controller URL because browsers block mixed content. Remote use should expose the Controller through a Tailscale HTTPS/MagicDNS address such as `https://pc01.<tailnet>.ts.net`.
- Browser Controller authorization must use a short-lived Controller-issued browser capability/session, not the Controller admin secret.
- No paid service/billing path is introduced.

## Current gate
Today: WEB CODE READY + TEST READY on PR #117 only. No MAIN/Production mutation. Real runtime acceptance requires the Controller Web contract and browser-safe authorization to be implemented by the owning backend stream, then Web can be pointed at PC01/Tailscale and display real JOB-001 without code-path substitution.
