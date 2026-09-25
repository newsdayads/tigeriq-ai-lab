# APP CHROME — EXECUTION V1
Authority issue: #1940
Spec: APP_CHROME_SPEC_LOCK.md
Plan: APP_CHROME_IMPLEMENTATION_PLAN.md
Rules: APP_CHROME_WORKING_RULES.md

STATUS=IN_PROGRESS
CURRENT_STEP=4
OWNER_APPROVAL=DUYỆT APP_CHROME_RECOVERY_V1
BASE_MAIN_HEAD=4238be367c1abff7790a06dc8087b69932a35ca1
LIVE_PRE_RECOVERY_HEAD=ede7348d6d21cbad9d8b2afc92e8cd776c78fbdf
LIVE_PRE_RECOVERY_DEPLOY=D:\TigerIQ\Apps\ChromeController\Deploy-final-ede7348
RECOVERY_ISSUE=#1940
DOC_LOCK_PR=#1941
CODE_BRANCH=fix/1940-app-chrome-local-continuity-v1
CODE_CANDIDATE_HEAD=a684bb5208d0742284e6bb75c194a0bae37835aa

## DONE
- STEP 1: SPEC LOCK — DONE.
- STEP 2: HANDOFF CONTRACT — DONE. PR #1941 merged; required checks 3/3 PASS.
- STEP 3: AUDIT CURRENT — DONE. Root cause and keep/remove delta persisted in #1940 and APP_CHROME_EVIDENCE.md.
- STEP 4 implementation candidate:
  - removed Core UI assignment endpoint and continuity assignment gates;
  - removed READY_UNASSIGNED gating;
  - changed NV02/NV03/NV04 prompt selection to local 21-prompt pool with 02/03/04 prefix;
  - changed READY derivation to local UI state;
  - removed assignment suppression from interrupted-response recovery and LOCAL_CONTINUE_NOW;
  - preserved awaitingWorkStart, WORKING no-send, pacing, F5/restart/recovery/model guards;
  - updated regression tests and added Recovery V1 spec-lock test.

## CURRENT
Verify STEP 4 candidate through PR diff + required CI/static/unit tests. Do not deploy before gates pass.

## NEXT
Open code PR, obtain required checks/gate. If PASS, merge and prepare bounded PC01 rollout for STEP 5 live per-worker tests.

## BLOCKER
None.

## DO_NOT_CHANGE
- local UI-only purpose;
- no Core/assignment/GitHub/queue/self-claim in App Chrome continuity;
- READY => one short local prompt;
- WORKING => no send;
- anti-spam/recovery/model bounded/watchdog fixes preserved.

## Native PC01 checkpoint — 2026-09-26 (superseding)

Authority: current Owner handoff on #1940; RESOURCE_SCOPE=APP_CHROME_RECOVERY_V1; MUTATION_OWNER=CODEX_LOCAL_PC01; ONE_WRITER=true; REMOTE_GUARD_HASH_DEBUG=STOP.

STAGING exact 72-file verification, PS5.1/Node syntax checks and injected rollback fixture passed. Candidate eea70521a9bedac701db218b0780ab0e7b3042c7 was installed through the approved local installer and all three services verified its provenance. NV02 live model acceptance failed. Local rollback to independently CI-verified baseline ede7348d6d21cbad9d8b2afc92e8cd776c78fbdf passed; baseline remains paused.

A concurrent Core zero-touch/#1888 installer replaced the baseline pointer during the transaction, violating the current one-writer handoff. Status: REAL BLOCKER; shared Core/control-plane repair was not performed. Candidate three-worker/lifecycle acceptance is incomplete. Native runtime/repository checkpoint and exact evidence are in APP_CHROME_WORK_STATE.json and APP_CHROME_NATIVE_EXECUTION_2026-09-26.md. No RDC/Guard work and no completion claim.