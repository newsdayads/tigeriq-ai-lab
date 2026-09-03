# WO-057 — PC01 Primary AI Compute & Control Node

Date: 2026-09-03
Status: DONE — PHYSICAL PC01 E2E A→G PASS
Branch: `wo057/pc01-primary-ai-compute-node`
Base: `wo056/pc01-one-click-bootstrap`
Repository gate: GitHub Actions `33720417131` PASS
Repository evidence: `docs/evidence/WO-057-REPOSITORY-GATE-2026-09-03.md`
Physical evidence: `docs/evidence/WO-057-PC01-PRIMARY-NODE-E2E-20260903T084302Z.json`
MAIN/Production: untouched
OpenClaw dependency: none

## Objective
Make PC01 self-sufficient as Control Plane + Primary AI Compute + Native Worker + Tool Executor + Scheduler/Router + Evidence/State node, with phones remaining optional specialized edge workers.

## Implemented scope
- Authenticated Controller ingress for PC01 registration and Work Order creation/readback.
- Device proof/replay protection retained for heartbeat, lease and result paths.
- Lease renewal endpoint without schema migration.
- PC01 Native Worker V1 with persistent asymmetric identity, register/heartbeat/lease/renew/result lifecycle, reconnect loop and duplicate in-flight guard.
- Ollama native adapter: `127.0.0.1:11434`, `qwen3:8b`, `num_ctx=4096`, `think=false`, low-temperature routine mode, metrics, `/api/ps` processor/VRAM evidence, max local AI concurrency = 2.
- Capability router: deterministic → tool → local AI → cloud limitation. Cloud is fail-closed unless separately configured/authorized.
- Structured Tool Executor using `spawn(..., shell:false)` and bounded local HTTP; workspace boundary, secret-path deny, protected-branch checkout deny, command timeout, exit/stdout/stderr capture and output truncation.
- Resource policy: free-RAM guard, CPU/RAM heartbeat metrics, bounded worker concurrency, local AI semaphore = 2.
- Evidence documents under `.tigeriq-runtime/evidence/<job>/` and durable result/evidence references in PostgreSQL.
- Reversible PC01 installer using the existing canonical Controller task plus one Native Worker Scheduled Task; generated local ingress secret is protected and never printed.
- Controller runtime dependency `pg@8.16.3` is provisioned idempotently after `npm ci`.
- Physical E2E A–G covers health, workforce, local AI/GPU, safe tool execution, intentional failure, concurrency=2 and service restart recovery.

## Repository verification
PASS:
- Linux typecheck, 58 unit tests, build and security/resource contract.
- Windows typecheck, 58 unit tests, build, Native Worker artifact and Windows PowerShell 5.1 parser gate.
- Authenticated ingress registration/intake tests.
- Ollama defaults/metrics mock contract tests.
- Tool executor policy tests.
- Router and local-AI concurrency=2 tests.

Not counted as PASS: 3 existing hosted PostgreSQL/device integration tests were skipped because their external integration environment was not configured. These are superseded for WO-057 physical acceptance by the completed PC01 A→G execution path where applicable; they are not retroactively claimed as hosted-CI PASS.

## Physical verification
Evidence run: `20260903T084302Z`
Evidence run head: `3bc06fdd5e1049e8b3ac7a6c093854a2562cd122`
Evidence commit/push head: `1f2e8ced3a066c52cb1da387c526f632a35563d6`

PASS:
- A — Health: Controller healthy, PostgreSQL healthy, `qwen3:8b` available, PC01 worker online/health=`ok`.
- B — Workforce: employees=1, devices=1.
- C — Local AI: real Work Order reached `done`; model=`qwen3:8b`; processor=`100% GPU`; evidence persisted.
- D — Tool Executor: deterministic read/write artifact path PASS.
- E — Failure handling: intentional missing-file job reached `failed` with failure/evidence persisted.
- F — Concurrency: two local-AI intervals overlap; configuredLocalAiMax=2.
- G — Recovery: Controller + Worker restart PASS and post-recovery Work Order reached `done`.
- Runtime configuration: contextLength=4096, deployed think=false, Controller/PostgreSQL healthy, PC01 online/health=`ok`.
- Evidence `allPass=true`.
- MAIN/Production untouched; OpenClaw unused; secrets not printed.

## Resolved physical rollout defects
1. Controller startup failed after `npm ci` because dynamic `pg` runtime dependency was absent. Fixed architecturally by idempotent pinned `pg@8.16.3` provisioning in the installer.
2. First recovery harness revision patched the installer before invoking its clean-repository guard. Recovery orchestration was corrected so the physical install can remain evidence-gated.
3. E2E assertion parameter typing caused a Windows PowerShell 5.1 transformation failure. The E2E harness was corrected to use PowerShell 5.1-safe truth evaluation.

## Database safety
WO-057 reuses migrations `001_operational_state_v1` and `002_device_proof_replay_v1`. No destructive migration/reset was performed.

## Independent review boundary
Repository CI and physical A→G are deterministic/physical evidence. An independent cloud/model reviewer is not fabricated or claimed. No such reviewer was required for this WO-057 physical acceptance gate.

## DONE gate
PASS. Implementation, repository tests/build, physical A→G, runtime configuration verification, durable evidence, failure handling, concurrency, recovery and Source-of-Truth updates are complete for WO-057.

Merge/release to MAIN/Production remains a separate explicit authorization gate and is outside this DONE scope.
