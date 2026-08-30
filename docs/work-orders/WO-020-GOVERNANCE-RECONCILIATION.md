# WO-020 — Governance Source-of-Truth reconciliation

Priority: P1
Status: IMPLEMENTING
Date: 2026-08-30

## Problem
Legacy PR #11 contains reviewed company governance documents that were never present in current MAIN. Closing the PR without reconciliation would discard the repository copy of the Company Constitution/Workflow/AI Employee Model/Decision Log/Source Index and privacy boundary. Its old CURRENT_STATE and branch-specific review scope are stale and must not overwrite current state.

## Scope
- Port the reviewed non-private company governance blobs from PR #11 into `docs/company/`.
- Explicitly exclude `04_TIGERIQ_OWNER_PROFILE_v1.md`.
- Port repository privacy boundary.
- Rewrite Source Review Scope as an active exact-SHA governance rule not tied to legacy PR #11.
- Merge decision precedence from legacy AGENTS into current engineering gate rules without losing current non-negotiables.
- Do not import PR #11 stale `docs/CURRENT_STATE.md`, README or architecture snapshot.
- No PC01/OpenClaw/Ollama mutation, no Tiger IQ Driver mutation, no paid/provider activation.

## Source blobs preserved from reviewed PR #11
- `01_TIGERIQ_COMPANY_CONSTITUTION_v1.md`: `b11a14cb1537753693c31c7a20a0e78a881a0571`
- `02_TIGERIQ_WORKFLOW_v1.md`: `2e0ec8522cf2e8f6a1cdbc14771459ebac519f23`
- `03_TIGERIQ_AI_EMPLOYEE_MODEL_v1.md`: `b9d377bbfea300efae56a6c92448c5a3d734937f`
- `05_TIGERIQ_DECISION_LOG_V1.md`: `2cc2209ce79fa8a8fe23b39c70867743724a2add`
- `06_TIGERIQ_SOURCE_INDEX_v1.md`: `4cbaa01cbc46e1ce434f5cf2585a626fdbe1ef21`
- `docs/PRIVACY_BOUNDARY.md`: `a659df618c536075316d12017610076ad13c7a5f`

## Gates
- Exact file set contains 01/02/03/05/06 and never 04.
- `AGENTS.md` contains both decision precedence and current evidence-gate rules.
- `docs/SOURCE_REVIEW_SCOPE.md` requires exact-SHA reviews and is not tied to legacy PR #11.
- Existing CI must remain green after reconciliation.
- Legacy PR #11 may be closed as superseded only after MAIN contains the reconciled governance set.
