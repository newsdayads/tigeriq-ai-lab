# WO-065 — Continuous Operations V1

Date: 2026-09-04
Status: IMPLEMENTED — REPOSITORY/PHYSICAL GATES PENDING
Branch: `wo065/continuous-operations-v1`
Base: verified WO-060..064 PC01 Autonomy quick-final PASS
MAIN/Production: untouched
OpenClaw: unused

## Objective
Add a durable top-level goal queue so PC01 can consume a finite set of explicitly supplied Owner-approved goals continuously, inject one eligible goal at a time into the existing Mission Orchestrator, continue past independent authorization-held goals, persist state across restart, and expose a global pause switch.

## Runtime
- App: `apps/continuous-operations/src/standalone.ts`.
- Goal queue: `F:\TigerIQ\Runtime\continuous-operations-v1\goals.json`.
- Control: `F:\TigerIQ\Runtime\continuous-operations-v1\control.json`.
- State: `F:\TigerIQ\Runtime\continuous-operations-v1\state.json`.
- Scheduled Task: `TigerIQ Continuous Operations`.
- Existing Mission Orchestrator inbox/state remain authoritative for mission execution.
- Existing Autonomous Planner remains authoritative for child Work Order dispatch and WO-059 authorization policy.

## Queue contract
- Up to 64 explicit goals.
- Priority: P0/P1/P2/P3.
- Optional goal dependencies; cycles and unknown dependencies fail closed.
- One active injected/running goal at a time.
- `waiting_authorization` is not treated as an active execution slot, so independent safe goals may continue.
- Terminal mission states reconcile back into goal state.
- Queue never invents a new goal when `goals.json` is empty.
- Global `paused=true` stops new goal injection while state reconciliation continues.

## Safety boundary
- This layer does not bypass Mission Orchestrator plan validation or WO-059 authorization classification.
- No MAIN/Production action.
- No automatic financial, destructive, irreversible or security-sensitive action.
- No credentials or secrets are written to queue/state/evidence.
- No goal synthesis when queue is empty; continuous execution is bounded by explicit queued goals.

## PC01 installation
Installer: `scripts/pc01-autonomy/Install-PC01-ContinuousOperations.ps1`.

Installer requirements:
1. PC01 + Administrator.
2. Exact feature branch and clean repository.
3. Repository typecheck/tests/build unless explicitly skipped after an equivalent verified gate.
4. Existing Mission Orchestrator runtime and Autonomy Supervisor.
5. Registers `TigerIQ Continuous Operations` at startup.
6. Patches the existing Autonomy Supervisor task list with an exact guarded replacement so Continuous Operations is also supervised.
7. Preserves existing goals/control/state files if already present.

## Repository acceptance
PASS requires:
- Linux typecheck/tests/build PASS.
- Windows typecheck/tests/build PASS.
- PowerShell parser PASS for the new installer.
- Continuous Operations unit tests PASS for empty queue/no invention, priority, dependency sequencing, authorization-held continuation, mission injection, terminal reconciliation and pause.

## Physical acceptance
PASS requires machine-readable evidence from PC01 proving:
1. Scheduled Task is Running.
2. Fresh `state.json` cycles are produced.
3. A two-goal safe queue runs goal A then goal B without manual per-goal action.
4. A held authorization goal does not block an independent GREEN goal.
5. Pause prevents new injection; resume allows the next goal.
6. Restart/supervisor recovery resumes from durable state without duplicate mission injection.
7. Controller/PostgreSQL/PC01/Ollama/Supervisor remain healthy.
8. MAIN/Production untouched and no financial action executed.

Only after repository and physical evidence PASS may WO-065 be marked DONE.
