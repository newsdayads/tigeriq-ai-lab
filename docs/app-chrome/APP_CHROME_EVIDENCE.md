# APP CHROME — EVIDENCE V1
Authority issue: #1940
Mode: append-only evidence log; corrections must preserve prior entry and add a superseding entry.

## E0 — Owner authorization
- Token: `DUYỆT APP_CHROME_RECOVERY_V1`
- Scope: 5-file lock + audit + fix + tests + reboot + branch/PR/check/review/merge/rollout within App Chrome recovery.

## E1 — Pre-recovery live baseline
Observed PC01 before recovery mutation:
- active deploy: `D:\TigerIQ\Apps\ChromeController\Deploy-final-ede7348`
- exact head: `ede7348d6d21cbad9d8b2afc92e8cd776c78fbdf`
- 3 windows open with fresh heartbeat.
- NV02 READY with `pendingContinue=false`; continuity effectively idle without assignment.
- NV03/NV04 READY with long Core/GitHub role-fallback/self-claim prompts in continuity state.
- NV02/NV03 model detector blocked at that observation; NV04 model verified.

Interpretation:
- transport/CDP/window liveness exists;
- behavior conflicts with locked SPEC because continuity depends on assignment/fallback architecture.

## E2 — Canonical source baseline
GitHub main at start of recovery:
`dc286c23581d7c233004fe1bcde424c1cdea3d52`.

Relevant current source confirms:
- `apps/chrome-controller/extension/continuity.js` contains 21 local continue prompts but special-cases NV02/NV03/NV04 into long Core/GitHub role fallback prompts.
- `apps/chrome-controller/direct-cdp-bridge.mjs` gates NV02 non-WORKING continuity on `currentWorkerAssignmentStatus('NV02')` and returns when not `CONTINUABLE`.
- generic NV03/NV04 continuity also consults assignment state.
- interrupted-response path suppresses continue when assignment is not CONTINUABLE.

This is the starting root-cause evidence for STEP 3.

## E3 — STEP 3 audit delta
Canonical source audit confirmed the drift:
- `direct-cdp-bridge.mjs` gated NV02 non-WORKING continuity on `currentWorkerAssignmentStatus('NV02')`.
- NV03/NV04 also used assignment status gates.
- Core `/api/ui-assignment` fed Core/role prompts into local continuity.
- `pickWorkerContinuePrompt` special-cased NV02/NV03/NV04 to long Core/GitHub self-claim prompts.
- tickWorker READY was partly derived from assignment state.
- interrupted response recovery and manual LOCAL_CONTINUE_NOW contained assignment gating.
- several regression tests explicitly enforced this wrong architecture.

Keep set:
CDP/window transport; 21 local prompts; awaitingWorkStart; WORKING no-send; 3–8s pacing; F5 5–20m; bounded restart/recovery; UTF-8/model bounded checks/watchdog/self-start.

## E4 — STEP 4 candidate
Branch: `fix/1940-app-chrome-local-continuity-v1`
Candidate source/test head before execution-doc updates: `a684bb5208d0742284e6bb75c194a0bae37835aa`.

Candidate changes:
- no `CORE_UI_ASSIGNMENT`, `currentWorkerAssignmentStatus`, `READY_UNASSIGNED`, `ROLE_FALLBACK`, `CORE_ASSIGNMENT`, or `CORE_CONTINUE` in Direct CDP bridge;
- `pickWorkerContinuePrompt` returns `<02|03|04> - <local short prompt>`;
- local UI composer/project/error state derives READY;
- anti-spam/lifecycle guards retained;
- new `chrome-controller-local-continuity-lock.test.ts` statically locks the Owner-approved architecture.

State: IMPLEMENTED_OFF_MAIN / NOT_YET_CI_VERIFIED / NOT_DEPLOYED.

## Native PC01 checkpoint — 2026-09-26 (superseding)

Authority: current Owner handoff on #1940; RESOURCE_SCOPE=APP_CHROME_RECOVERY_V1; MUTATION_OWNER=CODEX_LOCAL_PC01; ONE_WRITER=true; REMOTE_GUARD_HASH_DEBUG=STOP.

STAGING exact 72-file verification, PS5.1/Node syntax checks and injected rollback fixture passed. Candidate eea70521a9bedac701db218b0780ab0e7b3042c7 was installed through the approved local installer and all three services verified its provenance. NV02 live model acceptance failed. Local rollback to independently CI-verified baseline ede7348d6d21cbad9d8b2afc92e8cd776c78fbdf passed; baseline remains paused.

A concurrent Core zero-touch/#1888 installer replaced the baseline pointer during the transaction, violating the current one-writer handoff. Status: REAL BLOCKER; shared Core/control-plane repair was not performed. Candidate three-worker/lifecycle acceptance is incomplete. Native runtime/repository checkpoint and exact evidence are in APP_CHROME_WORK_STATE.json and APP_CHROME_NATIVE_EXECUTION_2026-09-26.md. No RDC/Guard work and no completion claim.