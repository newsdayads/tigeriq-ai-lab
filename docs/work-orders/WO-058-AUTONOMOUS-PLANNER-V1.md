# WO-058 — Autonomous Planner V1

Date: 2026-09-03
Status: IMPLEMENTED — REPOSITORY/PHYSICAL GATES PENDING
Branch: `wo058/autonomous-planner-v1`
Base: `wo057/pc01-primary-ai-compute-node`
MAIN/Production: untouched
OpenClaw dependency: none

## Objective
Turn PC01 from an executor that waits for Work Orders into a continuously running autonomous backlog dispatcher that can detect actionable machine-readable tasks, respect dependency/priority/authorization gates, create idempotent Controller Work Orders, track completion, and continue automatically.

## Implemented scope
- `Autonomous Planner V1` Node service for PC01.
- Runtime machine-readable backlog at `F:\TigerIQ\Runtime\autonomous-planner-v1\backlog.json`.
- Planner runtime state at `F:\TigerIQ\Runtime\autonomous-planner-v1\planner-state.json`.
- Priority ordering P0→P3.
- Dependency gating.
- Explicit `requiresAuthorization=true` hold state; no Controller Work Order is created for held tasks.
- Idempotent controller submission key `autonomy:<taskId>:v1`.
- Safe task schema with local_ai/tool/deterministic routes.
- Protected branch, credential-like path and path traversal rejection before dispatch.
- Planner syncs dispatched Controller jobs to done/failed state.
- Max dispatch per cycle is bounded.
- Windows Scheduled Task installer `TigerIQ Autonomous Planner` with startup/restart behavior.
- Installer preserves WO-057 baseline and re-provisions pinned `pg@8.16.3` after `npm ci`.
- Repository tests for priority, dependencies, authorization hold, idempotency and protected-path/branch rejection.
- Linux + Windows CI gate including PowerShell parser checks.

## Physical acceptance gate
The physical E2E injects three runtime backlog tasks without manual intervention after start:
1. A safe tool task that autonomously writes a deterministic artifact.
2. A dependent local-AI task released only after task A becomes DONE.
3. A task requiring authorization that must remain held and must not create its blocked artifact.

PASS requires:
- Planner Scheduled Task running.
- A auto-discovered, dispatched and DONE.
- B auto-released after A and DONE through `qwen3:8b` with GPU processor evidence.
- C `held_authorization` with no Controller job and no blocked artifact.
- Controller/PostgreSQL/PC01 Native Worker remain healthy.
- Machine-readable evidence under `docs/evidence/WO-058-AUTONOMOUS-PLANNER-E2E-<timestamp>.json`.

## Boundary
WO-058 provides autonomous execution of explicit machine-readable backlog tasks. It does not yet claim free-form goal decomposition from arbitrary natural-language Current State/Work Order prose. That higher-level mission decomposition is the next autonomy layer and must remain evidence-gated rather than fabricated.
