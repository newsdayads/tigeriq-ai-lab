# WO-059 Evidence — PC01 Primary Command Center

Date: 2026-09-03
Outcome: REAL_BLOCKER — repository implementation prepared; physical PC01 A–K not yet verified.

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

Commits:
- `51de1f82cbb41c1529cb262f44972ba3a77739fb` — Controller/PostgreSQL/worker telemetry.
- `650e580998705bd7fe53dcecf96173175ff43348` — Tailscale-only installer/autostart hardening.
- `b68a3a4de50ce53973700e49856562728ff0596f` — Command Center identity, real health projection, private-bind validation.
- `b618b52e834eed87a3158b4b96ed089939dedf6f` — dashboard security/identity/telemetry tests.
- `2da04370b0251092c45c2907c2aa9ebd67db7bda` — PC01 primary safety regression.

## A–K evidence status
- A Local PC01 open: NOT RUN — blocked by PC01 execution gate.
- B Desktop layout: repository regression prepared; PHYSICAL NOT RUN.
- C Mobile/responsive layout: repository regression prepared; PHYSICAL NOT RUN.
- D Tailscale remote device: NOT RUN.
- E Real telemetry: probes implemented; PHYSICAL NOT RUN.
- F Real Work Order datasource: existing durable journal path preserved; PHYSICAL NOT RUN.
- G Web -> PC01 -> execute -> evidence: FAIL/BLOCKED. PC01 received #194 but Secure V3 stopped AI execution before work could proceed.
- H Restart/autostart: installer configured AtStartup/SYSTEM; PHYSICAL NOT RUN.
- I No public exposure: static fail-closed implementation prepared; PHYSICAL listener check NOT RUN.
- J `deploymentEnabled=false`: PASS at repository configuration level; no deploy retry performed. Live project deployment settings endpoint was not exposed by the connected read tool, so no stronger live-setting claim is made.
- K Identity: repository regression prepared (`Vy — AI Chief of Staff`, `anh Sơn`, no `Sếp`); PHYSICAL NOT RUN.

## Security note
No secret values were read, printed, committed or logged. No public/wildcard bind was enabled. No Vercel production action, paid action, destructive database action or OpenClaw action was performed.

## Required next evidence
After the Secure V3 gate is satisfied through an authorized path, execute the WO-059 installer on PC01 and attach:
- emitted private URL/bind;
- Scheduled Task state after start and restart;
- `/api/server` redacted telemetry;
- desktop/mobile screenshots or browser validation;
- Tailscale remote access result;
- one test Work Order ID with queue claim, execution, reviewer/judge result and evidence;
- listener/firewall proof showing no wildcard/public exposure.
