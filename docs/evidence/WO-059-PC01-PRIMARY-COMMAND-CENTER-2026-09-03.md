# WO-059 Evidence — PC01 Primary Command Center

Date: 2026-09-03
Outcome: REAL_BLOCKER — repository implementation and CI are PASS; physical PC01 A–K are not yet fully verified.

## Audit evidence
- Repository: `newsdayads/tigeriq-ai-lab`.
- Audited MAIN: `e874fb7b800e8c0a3f961ed3d10b778ec5d4fc9c`.
- Canonical runtime issue: #194 `[P1] Make PC01 Command Center primary; Vercel backup`.
- PC01 responded on #194 with `TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW` and stated that Secure V3 requires three distinct immutable local Ollama model digests for AI jobs.
- Existing Command Center source is `apps/dashboard`; no replacement UI was created.
- Existing installer was found to default to stale branch `wo010/command-center-web-control`; WO-059 corrects this to `main` and adds explicit private startup/exposure checks.
- MAIN `vercel.json` contains `git.deploymentEnabled=false`.
- Live Vercel project read showed latest deployment `dpl_9GxMxVMcmC5s8JCSZQgHLdPtLBEb` in `ERROR` state; WO-059 performed no deployment/retry.

## Repository implementation evidence
Branch: `wo-059-pc01-primary-command-center`
PR: #195 `WO-059: Make PC01 Command Center primary; Vercel backup` — DRAFT, not merged.

Key commits:
- `51de1f82cbb41c1529cb262f44972ba3a77739fb` — initial Controller/PostgreSQL/worker telemetry.
- `650e580998705bd7fe53dcecf96173175ff43348` — initial Tailscale-only installer/autostart hardening.
- `b68a3a4de50ce53973700e49856562728ff0596f` — Command Center identity, real health projection, private-bind validation.
- `b618b52e834eed87a3158b4b96ed089939dedf6f` — dashboard security/identity/telemetry tests.
- `2da04370b0251092c45c2907c2aa9ebd67db7bda` — PC01 primary safety regression.
- `d6c859ad634456c988d69eb5874a270d43097208` — Web intake now creates a durable Work Order before entering the PC01 GitHub queue and marks it blocked if queue submission fails.
- `da70996d57b33b009f88fc44b3677cbcb5abca0d` — SYSTEM startup task receives existing GitHub queue auth through a protected local token file; token value is never printed or committed.
- `87e4b90b48d8585c5cef51018bc4421fb32da732` — telemetry reads real workforce counts/task state from the private Workforce Controller.
- `5a056770fc04a67006525bb0246d33a2229db399` — UI renders observed AI Workforce totals/status or `Chưa có dữ liệu` when unavailable/malformed.
- `bbdec79c4e3b27c48f28ab79875f64df5de7c0fd` — runtime/workforce rendering tests.
- `a3bf7d0e4335f92689f4b95989f4521d51cdd1ca` — static safety regression for workforce telemetry.

## CI evidence
GitHub Actions CI run `33740829196`, job `100602069156`, head `a3bf7d0e4335f92689f4b95989f4521d51cdd1ca`: **PASS**.

Passed steps:
- PowerShell syntax.
- Install (`npm ci`).
- Vercel deployment policy (`deploymentEnabled=false`).
- Typecheck.
- Unit tests.
- Playwright smoke/responsive tests.
- Build.

A prior CI run `33740412000` at head `e90204c85107a51c7b67517c21f529be4b9c3998` also passed all of the same gates before the final workforce projection was added.

## Data path evidence
- Work Order list/status + Evidence/Gate: durable `FileJournal` / `DurableControlPlane` at `F:\TigerIQ\State\control-plane.jsonl` when running on PC01.
- `Giao việc cho Vy`: creates a durable `WO-WEB-*` record first, transitions it to approved, then emits the existing `TIGERIQ_JOB_V1` queue issue containing that Work Order ID. Queue submission failure moves the durable Work Order to `blocked`.
- CPU/RAM/disk/uptime: Windows CIM.
- GPU: `nvidia-smi` when available.
- Ollama: localhost `127.0.0.1:11434/api/tags`.
- Tailscale: live Tailscale IPv4.
- Native Worker: actual Windows process probe.
- Workforce Controller + AI Workforce counts/tasks: private `/api/workforce/status` on the live Tailscale address.
- PostgreSQL: service/listener probe.
- Missing/malformed telemetry is not filled with fabricated values; UI falls back to unavailable/chưa có dữ liệu.

## A–K evidence status
- A Local PC01 open: **NOT RUN** — blocked by PC01 execution gate.
- B Desktop layout: **PASS (repository/Playwright)**; physical PC01 browser verification NOT RUN.
- C Mobile/responsive layout: **PASS (repository/Playwright)**; physical Owner mobile device verification NOT RUN.
- D Tailscale remote device: **NOT RUN**.
- E Real telemetry: probes/UI/CI **PASS at implementation level**; live PC01 values NOT RUN.
- F Real Work Order list/status: durable source + Web intake **PASS at implementation level**; live PC01 verification NOT RUN.
- G Web -> PC01 -> execute -> result/evidence: **BLOCKED**. PC01 received #194 but Secure V3 stopped AI execution because independent immutable local model requirements are not satisfied.
- H Restart/autostart: AtStartup/SYSTEM/restart configuration **PASS at implementation/CI level**; Windows restart recovery NOT RUN.
- I No public exposure: private-bind/firewall/listener fail-closed code + tests **PASS at implementation/CI level**; actual PC01 listener/firewall proof NOT RUN.
- J `deploymentEnabled=false`: **PASS at repository policy/CI level**; no deploy retry performed. Live project deployment settings endpoint was not exposed by the connected read tool, so no stronger live-setting claim is made.
- K Identity: **PASS at repository/Playwright regression level** (`Vy — AI Chief of Staff`, `em`, `anh Sơn`, no `Sếp`); physical PC01 UI verification NOT RUN.

## Security evidence
- No public/wildcard bind enabled.
- Tailnet firewall rule is scoped to local Tailscale IPv4 and remote `100.64.0.0/10`.
- Command secret and materialized existing GitHub token are ACL-restricted to SYSTEM/Administrators and are not printed in installer output.
- Existing auth, CSRF, idempotency and security headers remain in place.
- No Vercel production action, paid action, destructive database action, router port-forward, OpenClaw action or security-gate bypass was performed.

## REAL BLOCKER
The only reachable PC01 execution ingress evidenced in this runtime is the existing GitHub queue. Issue #194 proves that ingress reached PC01, but Secure V3 refused the AI job because it requires three distinct immutable local Ollama model digests for independent execution/review/judge. The current ChatGPT runtime does not expose a separate authenticated direct PC01 shell/service-control path.

The Secure V3 gate MUST NOT be weakened or bypassed merely to finish this Work Order.

## Required next evidence
After the Secure V3 gate is satisfied through an authorized path, execute the WO-059 installer on PC01 and attach:
- emitted private URL/bind;
- Scheduled Task state after start and after Windows/Command Center restart;
- `/api/server` redacted live telemetry;
- desktop/mobile physical validation;
- Tailscale access from another Owner device;
- one Web-created `WO-WEB-*` ID with PC01 claim, execute, reviewer/judge result and evidence;
- listener/firewall proof showing no wildcard/public exposure.
