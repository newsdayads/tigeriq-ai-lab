# Current State

Date: 2026-09-03

TigerIQ AI Lab remains evidence-gated. MAIN/Production are unchanged by WO-057; no automatic merge or production release is authorized.

## Active priority — WO-057 PC01 Primary AI Compute & Control Node

Status: REPOSITORY IMPLEMENTATION GATE PASS — PHYSICAL PC01 E2E REAL BLOCKER

Branch: `wo057/pc01-primary-ai-compute-node`
Base: `wo056/pc01-one-click-bootstrap`
Repository gate evidence: `docs/evidence/WO-057-REPOSITORY-GATE-2026-09-03.md`
Verified implementation head: `cd61e11d477191e0260a9264547c3372539e822f`
GitHub Actions run: `33720417131` PASS on Linux + Windows.

### Implemented and repository-verified
- PC01 Native Worker V1 independent of OpenClaw.
- PC01 employee/device registration, signed heartbeat, job lease, lease renewal, structured result/failure submission and reconnect lifecycle.
- Authenticated Work Order ingress and state readback.
- Ollama adapter defaults: `127.0.0.1:11434`, `qwen3:8b`, `num_ctx=4096`, `think=false`, low-temperature routine mode, timeout/keep-alive/metrics and processor/VRAM reporting where Ollama exposes it.
- Local-AI semaphore max concurrency = 2.
- Capability/model router with deterministic/tool/local-AI routing and fail-closed cloud limitation when no authorized provider exists.
- Structured Tool Executor with workspace boundary, protected-branch deny, secret-path deny, local-HTTP restriction, timeouts, output bounds and `spawn(..., shell:false)`.
- CPU/free-RAM heartbeat telemetry and free-RAM admission guard.
- Per-Work-Order evidence persistence under `.tigeriq-runtime/evidence/` with durable PostgreSQL evidence references after physical execution.
- One reversible Windows Scheduled Task installation path for the Native Worker; existing canonical Controller task is reused instead of creating a duplicate controller autostart mechanism.
- Physical A–G test package prepared: health, workforce, local AI/GPU, tool execution, intentional failure, concurrency=2 and service restart recovery.
- Repository gates: typecheck PASS, build PASS, security/resource contract PASS, Windows PowerShell 5.1 parser PASS, 58 unit tests PASS. 3 pre-existing PostgreSQL/device integration tests remain skipped in hosted CI and are not claimed as PASS.

### Not yet verified on physical PC01
- `employees >= 1` and `devices >= 1` after Native Worker registration.
- PC01 heartbeat ONLINE/healthy.
- qwen3:8b remains GPU-accelerated after deployment.
- Real Work Order → queue → lease → Worker → qwen3/tool → result → evidence → PostgreSQL path.
- Physical failure handling, 2-job concurrent local AI and restart/autostart recovery gates A–G.
- Independent AI reviewer PASS; deterministic CI/static tests are recorded instead and no independent model/provider is fabricated.

### REAL BLOCKER
This ChatGPT session has repository/GitHub access but no direct PC01 terminal execution channel. The Work-mode handoff for direct computer execution was not accepted, so physical installation/restart/E2E cannot be truthfully performed or claimed in this session.

### Next action
Execute the prepared one-click PC01 install + A–G physical E2E package through an authorized PC01 execution channel. Expected final physical evidence path:
`docs/evidence/WO-057-PC01-PRIMARY-NODE-E2E-<timestamp>.json`.

## Historical verified foundation

Earlier TigerIQ phases established governance/contracts, Work Orders/evidence, authorization, durable state/journal concepts, authenticated control-plane foundations, runtime safeguards and provider-neutral routing foundations. Historical evidence remains in its original Work Orders/evidence records.

## Historical — WO-007 PC Local AI Execution Worker

Previous status: PHYSICAL GATES PASS — PC01 AUTO MODE READY at the 2026-08-29 baseline using the prior local-worker architecture and `qwen2.5-coder:14b`. That historical result is retained as evidence but does not substitute for WO-057 physical verification because WO-057 introduces a new Native Worker, Work Intake, router/executor policy and recovery package.
