# Current State

Date: 2026-09-03
Status: Source of Truth for current operational state

TigerIQ AI Lab is being operated as an AI-native company/control system. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated unless explicitly included in a Work Order.

## Current architecture decision — P0
- **PRIMARY Web Control:** PC01 TigerIQ Command Center using the existing `apps/dashboard` implementation.
- **SECONDARY/BACKUP:** Vercel.
- Vercel is not the normal daily execution critical path.
- `vercel.json` on audited MAIN has `git.deploymentEnabled=false`; no Vercel deploy retry is authorized while quota remains blocked.
- Remote Command Center access is private-only: localhost or an explicit approved Tailscale/private address. Router/public exposure and wildcard `0.0.0.0` / `::` binds are forbidden.
- Command Center runtime data must be evidence-backed. Missing data renders `Unavailable` / `Chưa có dữ liệu`; no mock telemetry or invented workforce state.

## Audited repository baseline
- Repository: `newsdayads/tigeriq-ai-lab`.
- MAIN audited for WO-059: `e874fb7b800e8c0a3f961ed3d10b778ec5d4fc9c`.
- MAIN contains the responsive Desktop/Mobile Command Center in `apps/dashboard`.
- Existing security boundary includes local command auth, session cookie, CSRF check, idempotency handling and security headers.
- Existing Web-to-PC01 ingress creates `TIGERIQ_JOB_V1` GitHub issues consumed by the PC01 queue worker.
- Existing local Command Center datasource uses the durable control-plane journal at `F:\TigerIQ\State\control-plane.jsonl` when run on PC01.

## PC01 prior baseline
Current Owner instruction identifies WO-057 `PC01 Primary AI Compute Node` as DONE with prior physical E2E A→G PASS and states PC01 has Controller, PostgreSQL, Native Worker, Ollama `qwen3:8b` GPU, Tool Executor, Scheduler/Router and Evidence. WO-059 does not re-label that prior claim as new evidence; all runtime facts required for the new Command Center deployment are re-verified before WO-059 can be DONE.

## Active priority — WO-059
Canonical runtime ingress: Issue #194 `[P1] Make PC01 Command Center primary; Vercel backup`.

Implementation branch: `wo-059-pc01-primary-command-center`.

Prepared changes:
- correct stale Command Center installer branch default to `main`;
- Windows startup Scheduled Task as SYSTEM with restart policy;
- explicit Tailscale CGNAT/private bind validation and tailnet-only firewall rule;
- fail-closed listener exposure check;
- real PC01 telemetry for CPU/RAM/disk/uptime, GPU, Ollama, Tailscale, Native Worker, Workforce Controller and PostgreSQL;
- `Vy — AI Chief of Staff` identity, `anh Sơn` address and `Giao việc cho Vy` UI;
- AI Workforce panel derived from observed PC01 runtime only;
- regression tests for auth/CSRF/idempotency/security headers/private bind/responsive UI/identity/Vercel policy.

## Current REAL BLOCKER
PC01 received Issue #194 and returned `TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW` with the reason: Secure V3 requires three distinct immutable local Ollama model digests for AI jobs.

The current ChatGPT runtime does not expose an authenticated direct PC01 shell/service-control channel outside that gated queue. Therefore WO-059 cannot truthfully claim the following physical checks yet:
- local Command Center launch;
- real private URL;
- Tailscale access from another device;
- Windows restart/autostart recovery;
- live telemetry values;
- Web → PC01 execute → result/evidence;
- listener/firewall proof on the actual PC01 host.

The Secure V3 independent-review gate must not be weakened merely to finish WO-059.

## Vercel state
- Repository policy: `git.deploymentEnabled=false` — verified on audited MAIN.
- Connected Vercel project `tigeriq-ai-lab` was read without mutation; latest deployment observed during WO-059 was in `ERROR` state.
- WO-059 performed no Vercel deployment, retry, paid upgrade or Production promotion.

## Required physical verification A–K
A. Command Center opens directly on PC01.
B. Desktop layout PASS.
C. Mobile/responsive layout PASS.
D. Tailscale access from another Owner device PASS.
E. CPU/RAM/GPU/Ollama/PostgreSQL/Worker telemetry real PASS or unavailable correctly.
F. Work Order list/status reads real durable state PASS.
G. One Web-submitted Work Order reaches PC01, executes and returns result/evidence PASS.
H. Windows/service or Command Center restart auto-recovers PASS.
I. No public exposure PASS.
J. Vercel deployment disabled PASS.
K. Identity regression PASS: `Vy — AI Chief of Staff`, AI self-reference `em`, user address `anh Sơn`.

## Next action
Satisfy the existing Secure V3 three-distinct-model review requirement through an authorized PC01 path, or use an already-authorized authenticated non-AI local operations execution channel. Then run the WO-059 installer on PC01, execute A–K, record evidence, independently review/judge, and only then mark WO-059 DONE.

## Evidence
- `docs/work-orders/WO-059-PC01-PRIMARY-COMMAND-CENTER.md`
- `docs/evidence/WO-059-PC01-PRIMARY-COMMAND-CENTER-2026-09-03.md`
- GitHub Issue #194

## Operating model
Owner → Vy / Chief of Staff → Work Order → AI/Device Employee → Execution → Independent Review → Judge/Gate → Evidence/State → concise Owner report.

No task is DONE solely because code or documentation changed. Runtime/deployment work requires applicable physical evidence and gates.
