# Evidence — OpenClaw local fallback preparation

Date: 2026-09-04
Status: PREP_PASS / RUNTIME_EVIDENCE_PENDING
Branch: `openclaw/local-fallback-benchmark-20260904`
PR: #315

## Completed in this execution cycle
- Reused the existing OpenClaw fallback work branch/PR; no duplicate workstream was created.
- Audited `docs/CURRENT_STATE.md` and the OpenClaw handoff before changes.
- Hardened `scripts/pc-worker/openclaw-local-model-benchmark.ps1` so it remains client-only and fail-closed around shared Ollama.
- Added a read-only gateway/task/listener/config-hash audit before benchmark inference.
- Replaced the initial CLI-text idle decision with Ollama `GET /api/ps` as the machine-readable safety/offload source.
- Added exclusive benchmark locking and between-run idle/contention gates.
- Pinned benchmark requests to `think=false`, `keep_alive=0`, explicit `num_ctx`, deterministic output and bounded timeout.
- A run is accepted only when exact output, runtime model observation and no model-level contention are all evidenced.
- Corrected fallback design to use a new/default-model OpenClaw session for failover validation; user-pinned model sessions are not accepted as fallback proof.
- Narrowed the future config concept to one proven Ollama fallback plus per-model params; no shared Ollama service mutation and no broad provider inventory replacement.

## Verification evidence
- Hardened benchmark script commit: `8da575c9a70b88cb980aa0006213864bc4dcd0a6`.
- CI run `33870482992`: SUCCESS, including PowerShell syntax, typecheck/tests/build gates.
- Vercel online verify run `33870483016`: SUCCESS; informational only for this PC01 scope.
- Design correction commit: `98ce034464189536af49f2af25f33f38eefcb478`.
- Latest head CI and Vercel verify checks completed successfully.
- WO-014 Queue Hygiene remains failed at the unrelated Work Board UI check; its deterministic queue hygiene checks passed and this failure is not runtime evidence for or against the OpenClaw benchmark.

## Safety / unchanged state
- MAIN/Production: UNCHANGED.
- Working OpenAI path `openai/gpt-5.6-sol`: UNCHANGED.
- OpenClaw runtime configuration on PC01: UNCHANGED by this cycle.
- Shared Ollama service configuration: UNCHANGED.
- Protected PC01 runtimes: no restart/reconfiguration evidence claimed.
- No local fallback is configured or claimed PASS.

## Current blocker / required next evidence
The current ChatGPT runtime has GitHub control but no direct PC01 shell/localhost/Tailscale execution capability. Therefore the prepared benchmark cannot be truthfully claimed executed on PC01 from this session.

Next physical/runtime gate:
1. Execute the branch benchmark harness once on PC01 while shared Ollama is idle.
2. Collect the generated `D:\TigerIQ\OpenClaw\diagnostics\OPENCLAW_LOCAL_BENCH_<timestamp>.json`.
3. Require one 8192-context profile with 3/3 benchmark PASS and usable latency/offload evidence before any fallback configuration.
4. Then perform OpenClaw local E2E/AGENTS-policy validation and three consecutive local PASS turns.
5. Only then apply exactly one local fallback and validate deliberate failover plus recovery to the OpenAI primary.

Until those runtime gates pass, status remains `RUNTIME_EVIDENCE_PENDING` and hybrid/offline resilience is NOT DONE.
