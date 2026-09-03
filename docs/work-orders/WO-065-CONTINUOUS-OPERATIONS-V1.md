# WO-065 — Continuous Operations V1

Date: 2026-09-04
Status: REPOSITORY GATE PASS — PHYSICAL PC01 GATE PENDING
Branch: `wo065/continuous-operations-v1`
Base: verified WO-060..064 PC01 Autonomy quick-final PASS
MAIN/Production: untouched
OpenClaw: unused

## Objective
Add a durable top-level goal queue so PC01 can consume a finite set of explicitly supplied Owner-approved goals continuously, inject one eligible goal at a time into the existing Mission Orchestrator, continue past independent authorization-held goals, persist state across restart, and expose a global pause switch.

WO-065 is the first runtime foundation in `docs/roadmap/TIGERIQ-CONTINUOUS-DEVELOPMENT-FLOW-V2.md`. Later roadmap phases extend this loop with durable event state, recovery, multi-provider AI Gateway/employee pools, Web Control and browser access, without replacing the verified Mission/Planner/Authorization core.

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
- Optional dependencies; cycles and unknown dependencies fail closed.
- A dependency that finishes failed/blocked/disabled propagates to `blocked_dependency`; dependents do not wait forever.
- One active injected/running goal at a time.
- `waiting_authorization` does not occupy the active execution slot, so independent safe goals may continue.
- Terminal mission states reconcile back into goal state.
- Queue never invents a new goal when `goals.json` is empty.
- Global `paused=true` stops new injection while reconciliation continues.

## Safety boundary
- No bypass of Mission Orchestrator plan validation or WO-059 authorization classification.
- No MAIN/Production action.
- No automatic financial, destructive, irreversible or security-sensitive action.
- No credentials/secrets written to queue/state/evidence.
- No autonomous Owner-goal invention.

## Repository acceptance — PASS

Verified code head: `81dd0ae326017d94efc719e81adecd55510fd930`
GitHub Actions: run `33784226498` — SUCCESS

Evidence:
- typecheck PASS;
- 79 tests PASS, 3 environment integration tests skipped;
- `tests/continuous-operations.test.ts`: 9 PASS;
- Playwright smoke: 1/1 PASS;
- build PASS;
- PowerShell parser gate PASS for WO-065 scripts.

Roadmap/state documentation commits after this code head do not change the runtime implementation; any branch-head CI produced by those documentation commits must be observed separately before claiming a new exact-head CI result.

## PC01 installation
Installer: `scripts/pc01-autonomy/Install-PC01-ContinuousOperations.ps1`.
Physical one-shot acceptance script: `scripts/pc01-autonomy/Invoke-PC01-ContinuousOperations-E2E.ps1`.

Installer requirements:
1. PC01 + Administrator.
2. Exact feature branch and clean repository.
3. Repository typecheck/tests/build unless explicitly skipped after equivalent verified evidence.
4. Existing Mission Orchestrator runtime and Autonomy Supervisor.
5. Registers `TigerIQ Continuous Operations` at startup.
6. Patches the existing Autonomy Supervisor task list using an exact guarded replacement.
7. Preserves existing goals/control/state files if already present.

## Physical acceptance — PENDING

PASS requires machine-readable evidence from PC01 proving:
1. Scheduled Task is Running.
2. Fresh `state.json` cycles are produced.
3. Two safe queued goals run A then B without manual per-goal action.
4. Authorization-held work does not block an independent GREEN goal.
5. Pause prevents new injection; resume allows the next eligible goal.
6. Restart/supervisor recovery resumes without duplicate mission injection.
7. Controller/PostgreSQL/PC01/Ollama/Supervisor remain healthy.
8. MAIN/Production untouched and no financial action executed.

Only after physical evidence PASS may WO-065 be marked DONE.
