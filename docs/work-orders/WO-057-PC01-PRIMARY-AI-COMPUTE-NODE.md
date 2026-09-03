# WO-057 — PC01 Primary AI Compute & Control Node

Date: 2026-09-03
Status: IMPLEMENTED IN FEATURE BRANCH — REPOSITORY GATES RUNNING; PHYSICAL PC01 E2E REQUIRED
Branch: `wo057/pc01-primary-ai-compute-node`
Base: `wo056/pc01-one-click-bootstrap`
MAIN/Production: untouched
OpenClaw dependency: none

## Objective
Make PC01 self-sufficient as Control Plane + Primary AI Compute + Native Worker + Tool Executor + Scheduler/Router + Evidence/State node, with phones remaining optional specialized edge workers.

## Implemented scope
- Authenticated Controller ingress for PC01 registration and Work Order creation/readback.
- Existing device proof/replay protection retained for heartbeat, lease and result paths.
- Lease renewal endpoint without schema migration.
- PC01 Native Worker V1 with persistent asymmetric identity, register/heartbeat/lease/renew/result lifecycle, reconnect loop and duplicate in-flight guard.
- Ollama native adapter: `127.0.0.1:11434`, `qwen3:8b`, `num_ctx=4096`, `think=false`, low-temperature routine mode, metrics, `/api/ps` processor/VRAM evidence, max local AI concurrency = 2.
- Capability router: deterministic → tool → local AI → cloud limitation. Cloud is fail-closed unless separately configured/authorized.
- Structured tool executor using `spawn(..., shell:false)` and bounded local HTTP; workspace boundary, secret-path deny, protected-branch checkout deny, command timeout, exit/stdout/stderr capture and output truncation.
- Resource policy: free-RAM guard, CPU/RAM heartbeat metrics, bounded worker concurrency, local AI semaphore = 2.
- Evidence documents under `.tigeriq-runtime/evidence/<job>/` and durable result/evidence references in PostgreSQL.
- Reversible PC01 installer using the existing canonical Controller task plus one Native Worker scheduled task; generated local ingress secret is protected and never printed.
- Physical E2E gate A–G covering health, workforce, local AI/GPU, safe tool execution, intentional failure, concurrency=2 and service restart recovery.

## No database reset/migration
WO-057 reuses migrations `001_operational_state_v1` and `002_device_proof_replay_v1`. No destructive migration is introduced.

## Independent review boundary
Repository CI is deterministic evidence. It is not claimed as independent AI review. High-impact independent AI reviewer/judge remains unclaimed unless an actually independent route/provider is available and tested.

## Physical execution boundary
This ChatGPT session has GitHub access but no direct PC01 terminal/browser execution channel. The Work-mode handoff was not accepted, so physical install/restart/E2E cannot truthfully be claimed from this session. Repository implementation therefore stops at REAL BLOCKER until PC01 executes:

- `scripts/pc01-primary-node/Install-PC01-PrimaryNode.ps1`
- `scripts/pc01-primary-node/Invoke-PC01-PrimaryNode-E2E.ps1`

The physical gate writes machine-readable evidence to `docs/evidence/WO-057-PC01-PRIMARY-NODE-E2E-<timestamp>.json`.

## DONE gate
DONE only after repository CI PASS + physical A–G PASS + employees/devices >= 1 + PC01 online/healthy + qwen3:8b GPU evidence + Current State reconciliation. No cloud/reviewer capability may be claimed unless independently configured/tested.
