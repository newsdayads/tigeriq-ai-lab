# PC01 Autonomy Supervisor V2 — Evidence

Date: 2026-09-09 (+07)
Scope: #318 PC01 autonomy, isolated from NV02/Groq, NV04/Gemini, Web Control V5, browser sessions, MAIN/Production.

## Outcome
- Added `scripts/pc-worker/autonomy-supervisor-v2.ps1`.
- Installed runtime copy at `D:\TigerIQ\Runtime\autonomy-supervisor-v2\run-autonomy-supervisor-v2.ps1`.
- Scheduled Task `TigerIQ Autonomy Supervisor V2` runs as SYSTEM and is active.
- Legacy `TigerIQ Autonomy Supervisor` is disabled but preserved for rollback.
- V2 writes atomic status to `D:\TigerIQ\Runtime\autonomy-supervisor-v2\status.json` and event history to `events.jsonl`.

## Monitored surfaces
- Workforce Controller + PostgreSQL + PC01 heartbeat/online state.
- Command Center health.
- Ollama health.
- OpenClaw Gateway health.
- Autonomous Planner, Mission Orchestrator, PC01 Native Worker.
- NV02 worker observation only; no autonomous mutation of its provider lane.
- Remote Desktop Commander observation only.
- CPU, RAM, queued jobs, active leases, queue-stall state, duplicate process count.

## Recovery / stall safeguards
- Auto-repair is limited to owned core services; Web Control, browser sessions and provider routing are explicitly excluded.
- Repair begins only after repeated unhealthy observations.
- Restart attempts use bounded exponential backoff.
- Queue-stall detection requires queued work with zero active leases for at least 90 seconds.
- Stale PC01 heartbeat triggers bounded Native Worker repair.
- Self-test creates a disposable SYSTEM scheduled-task target, forces the bounded-repair path, verifies recovery, then removes the target.

## Verification
- Parser errors: 0.
- Self-test repair outcome: `recovered`.
- Queue-stall truth table: queued=1/lease=0/stale>90s => true; active lease => false; empty queue => false.
- Three consecutive live health samples returned overallOk=true with PostgreSQL=true and PC01 online=true.
- Latest live check after false-positive fixes: overallOk=true; canonical Command Center processCount=1; duplicateProcess=false.
- Existing Web Control candidate dashboard processes were correctly excluded from canonical Command Center duplicate detection.

## Boundaries
- No reboot performed in this lane.
- No provider-router mutation.
- No Web Control mutation.
- No browser/session mutation.
- No MAIN/Production merge.
- Runtime rollback backup exists for Supervisor V1 task definition.

## Machine evidence
- Final machine evidence: `D:\TigerIQ\Evidence\pc01-autonomy-24x7\SUPERVISOR-V2-FINAL-20260909.json`.
- Source/runtime SHA256 match: `371ed1fdb7c0ee321df4f0b250cf59fccc5a25712f89f28771e7b84a7bb8d03d`.
- Final three distinct live snapshots: 3/3 `overallOk=true`, PostgreSQL=true, PC01 online=true, queueStalled=false, zero critical failures, canonical Command Center processCount=1.
