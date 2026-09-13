# TigerIQ - Current State

Date: 2026-09-14
Status: PARTIAL LIVE CONTAINMENT; PR #737 OFF-MAIN; RELEASE AUTHORIZATION BLOCKED
Authority: current Owner instruction > Constitution/Workflow > this evidence-backed snapshot.

## Current operational facts
- PR #737 is the only Step 1 migration PR, branch `codex/stabilize-foundation-step1`.
- No MAIN merge or production artifact deployment has occurred.
- Coding Lane task is Disabled; canonical worker PID 6852 and launcher are stopped.
- Runtime Updater task was already Disabled and remains Disabled; no updater process was observed.
- 61 legacy coding jobs and 55 coding objectives were snapshotted into `tigeriq_legacy_quarantine`
  before blocking. 12 done jobs and 13 completed objectives survive; zero payload mismatches.
- No legacy coding leases remain. Core's 25 done jobs and 27 completed objectives were not changed.
- Core PID 5912 and Web PID 13976 remain running/healthy. Old Web correctly reports the stopped
  Coding endpoint as unavailable; the new explicit DISABLED presentation awaits approved rollout.
- Windows rejected a start attempt on the disabled Coding task. No new coding rows were observed
  between quarantine and the subsequent observation. This is NOT a reboot/full-rollout proof.

## Unresolved release boundary
Core's two GitHub intake timers, manager, job dispatcher and self-check are in the existing Core process.
MAIN has no supported live pause API. Stopping its signals closes Core HTTP; changing those functions
requires a verified artifact rollout and controlled Core restart, currently forbidden until Owner approval.
Do not claim full containment, post-reboot verification or production completion before that boundary.
Do not use debugger injection, database triggers/locks or credential changes as a workaround.

## Coding direction
Codex is the proposed coding path: one approved product issue -> isolated Codex branch/PR -> exact-SHA
CI -> independent review -> smoke -> Owner acceptance. No new shadow queue, manager, auditor,
repair/failover layer or replacement Coding Lane is authorized.
Existing GitHub issues retain queue identity; Core/Web retain state/routing/reporting responsibilities.
API workers remain candidates for research/review/support. The pilot issue is not created until release approval
and successful controlled rollout/smoke. Final primary-coder cutover still requires the representative pilots.

## PR disposition and evidence
- Closed without merge: #732 (manager retry/failover), #719 (rotating auditor), superseded by containment.
- Preserved unchanged: Web product PRs #720, #652, #648, #646. They are not automatically accepted or replayed.
- Operational evidence and rollback: `docs/evidence/STEP1-PC01-CONTAINMENT-20260914.md`.
- Earlier source/CI evidence: PR #737 head `f102d7d17e0bccb061d741e5982d625c4f3bbde7`, all 3 workflows passed.
- The new documentation head must pass the same complete workflows and independent review before approval.

## Historical Snapshot (not current authority)
The following prior state is retained as history only. Its automatic repair/revival authorization is superseded
by the current Owner containment instruction and must not be used to restart Coding Lane.


Date: 2026-09-12
Status: CURRENT — 24/7 autonomy self-heal verified
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical runtime
- Core: `100.97.23.87:8795`.
- Web Control: `100.97.23.87:8796`, read-only runtime truth.
- Coding Lane: `100.97.23.87:8797`.
- PostgreSQL: `5432`; Ollama: `127.0.0.1:11434`.
- Source path: GitHub branch → PR → required gates → merge. No direct `main` source editing on PC01.

## Autonomous Coding Lane
- Manager decomposes eligible zero-cost repository work into bounded jobs.
- Implementer works on an isolated branch; reviewer must differ from implementer.
- Required gates: CI Verify, Queue Hygiene Verify, Vercel Online Verify.
- Paid, credential/security, destructive, production/release and browser-auth work fail closed.
- Autonomous repair is allowed only while the originating GitHub issue remains OPEN.

## 24/7 self-heal — VERIFIED
- Issue #631 implementation: PRs #633, #634, #637; all required gates PASS before merge.
- Final verified runtime SHA: `c2cc3b228e15d8d10cc5f7201a892124a3d8abce`.
- Runtime updater checks Core/Web/Coding health continuously, uses two-strike detection and 5-minute cooldown, and restarts only the failed service.
- Coding autonomy supervisor detects retryable CI failures and stale `running/waiting_ci/review` jobs, uses a bounded retry budget, records machine-readable events, and blocks exhausted work instead of looping forever.
- Exact Coding child PID matching is based on canonical entry path.

## Live fault evidence
- Service self-heal test: Coding PID `21564 → 10112`; Core PID `40448` unchanged; Web PID `15692` unchanged. PASS.
- Stalled-job test: `STALL_TIMEOUT` detected; budget exhausted → `BLOCKED`; `retryQueued=false`; machine-readable events recorded. PASS.
- Autonomous CI repair was observed: failed #631 job produced repair job `CODE-fb0873b2-e29f-4f64-8966-fe95fdc62c76` automatically.
- Superseded autonomous PRs #632 and #638 are closed and not merged.
- Evidence: `docs/evidence/ISSUE-631-AUTONOMY-SELF-HEAL-20260912.md`.

## Web Control
- Final implementation from PRs #626/#628/#629 remains verified.
- UI matrix: 8 widths × 2 zoom levels = 16/16 PASS; no overflow, console/page/network errors; filters PASS.
- Pipeline truth: Intake → Running → Review → CI → Done → Blocked.
- Evidence: `docs/evidence/WEB-CONTROL-FINAL-20260912.md`.

## Final live runtime verification
- Core: healthy, PID `40448`.
- Web Control: healthy, PID `15692`.
- Coding Lane: healthy, PID `16108`, 3 eligible resources.
- Coding Lane Scheduled Task: Running.
- Runtime Updater Scheduled Task: Running.
- Runtime updater state: `NO_CHANGE`.
- Watchdog: `ok=true`; Core/Web/Coding all healthy.

## Source of Truth
- CENTRAL #280: active dynamic queue/router.
- Registry #335: current employee/resource registry unless separately changed.
- Interaction #504 and browser guardrail #497 remain applicable.
- Execution boundary: `docs/EXECUTION_BOUNDARY.md`.
- Chat/memory is not runtime authority.

STATE: `CURRENT_V47_AUTONOMY_24X7_SELF_HEAL_STALL_WATCHDOG_PASS_20260912`

