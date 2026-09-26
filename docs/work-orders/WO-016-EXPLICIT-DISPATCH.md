# WO-016 — Explicit dispatch fallback + work view

Status: DONE
Date: 2026-08-30

## Goal
Keep TigerIQ AI operational while conversational GPT inference is blocked by the deferred Vercel AI Gateway billing gate.

## Delivered
- Added explicit `Giao việc` action beside normal chat. It bypasses AI intent classification only when the owner deliberately selects that action.
- Reused existing GitHub authorization, fingerprint dedupe and lifecycle tracking.
- Marked direct dispatch truthfully as `vercel-explicit-dispatch`; Chief-classified requests remain `vercel-chat-chief-of-staff`.
- Normal chat remains fail-safe: GPT failure never silently creates a Work Order.
- Added `Công việc` operator action.
- No PC01/OpenClaw/Ollama mutation, no Tiger IQ Driver changes, no billing retry.

## Verification
- PR #68: `WO-016: explicit dispatch fallback + work view`.
- Exact-head implementation SHA: `a4991ba8c8cd392979e5de6a5829813b2faff123`.
- Exact-head CI / Queue Hygiene / Vercel Verify and Preview gates PASS before merge.
- PR #68 merged to MAIN as `c483d24dc18c70494c8d64468b93e908f3763e36`.
- Production deployment `dpl_GqmDmm1R4V2Rxs7TMMcaqLRZU1Je`: READY.
- Production `/api/control`: HTTP 200, `explicitDispatch=true`, canonical queue still #57/#58.
- Production UI exposes `Giao việc` and `Công việc`.
- No artificial Production Work Order was created solely for write-path smoke verification.
