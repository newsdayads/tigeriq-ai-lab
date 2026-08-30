# Current State

Date: 2026-08-30

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production baseline

- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- MAIN includes PR #65 / WO-013 Chief-of-Staff chat, PR #66 / WO-014 queue hygiene, PR #67 / WO-015 lifecycle + PWA, PR #68 / WO-016 explicit dispatch fallback, PR #73 / WO-017 evidence-first Work Board, and PR #74 / WO-018 retry-safe lifecycle ordering.
- Current MAIN after WO-018: `ba059c59dc13c91a4c7f2abc26b2a1ad8afd164b`.
- Production deployment `dpl_5cjyVfkGJ2wPLsBLCXhGF9nU9Yuj`: READY.
- Production `/api/control`: HTTP 200; Vercel and GitHub online.
- Advertised deterministic capabilities: `workOrderDedupe=true`, `workOrderStatusTracking=true`, `workOrderLifecycleEvidence=true`, `explicitDispatch=true`, `workBoard=true`.
- Current execution queue remains exactly canonical PC01 issues #57 and #58.
- PC01 reports offline from current GitHub evidence; OpenClaw/Ollama remain unknown. WO-013 through WO-018 did not mutate PC01/OpenClaw/Ollama.

## WO-013 — Chief of Staff chat

Status: CODE + CI + PRODUCTION DEPLOY PASS; AI GATEWAY RUNTIME BLOCKED BY VERCEL BILLING REQUIREMENT

Implemented:
- TigerIQ AI is the single Chief-of-Staff chat entry point.
- Ordinary questions/discussion/planning route to an OpenAI-first Chief model through Vercel AI Gateway.
- Conversation history is provided for contextual confirmations such as `Làm` / `Tiếp`.
- Status remains deterministic/tool-first and does not call an LLM.
- Ambiguous execution intent returns clarification instead of creating a Work Order.
- AI failure is fail-safe and never silently creates a Work Order.
- Vercel OIDC uses the official `@vercel/oidc` runtime helper; no provider secret is committed.

Runtime evidence:
- Production status endpoint HTTP 200.
- Production Chief smoke reached Vercel AI Gateway but returned HTTP 403 requiring a valid credit card on file before Gateway inference/free credits.
- No conversational model inference has completed yet; no runtime PASS claim is permitted.

## WO-014 — Web Control queue hygiene

Status: DONE

- Deterministic Work Order fingerprinting and duplicate prevention.
- Repeated identical open requests return the existing Work Order.
- Read-only `work-order-status` tracks lifecycle from GitHub issue/evidence state.
- Test/misclassified/duplicate issues #61, #62, #63 and duplicate canary #64 were closed with evidence.
- Canonical PC01 tracking remains #57/#58.

## WO-015 — Lifecycle + mobile/PWA hardening

Status: DONE

- Lifecycle stages: queued / claimed / completed / failed / cancelled.
- Read-only status returns sanitized evidence booleans and never raw comment bodies.
- Recently created Work Orders are tracked locally and polled for stage changes.
- `Kiểm tra PC01` reads canonical canary #58 and never creates a duplicate canary.
- PWA/mobile metadata, manifest, standalone mode and network-only service worker are in Production.

## WO-016 — Explicit dispatch fallback + work view

Status: DONE — EXACT-HEAD GATES PASS + PREVIEW READY + PRODUCTION READY + STATUS/UI RUNTIME PASS

Implemented:
- Explicit `Giao việc` action bypasses GPT classification only when the owner deliberately selects it.
- Direct dispatch reuses existing GitHub authorization, fingerprint dedupe and lifecycle tracking.
- Direct Work Orders are truthfully marked `vercel-explicit-dispatch`; Chief-classified work remains `vercel-chat-chief-of-staff`.
- Normal chat remains fail-safe when AI Gateway is unavailable.
- `Công việc` action was introduced for operational visibility.

Evidence:
- PR #68 merged to MAIN as `c483d24dc18c70494c8d64468b93e908f3763e36` after exact-head CI / Queue Hygiene / Vercel Verify and Preview gates PASS.
- Production deployment `dpl_GqmDmm1R4V2Rxs7TMMcaqLRZU1Je`: READY.
- Production `/api/control`: HTTP 200 with `explicitDispatch=true`; canonical queue remained #57/#58.
- Production UI contains `Giao việc` and `Công việc` controls.
- No test Work Order was created in Production solely for smoke verification; therefore direct write runtime was not artificially exercised.

## WO-017 — Evidence-first Work Board

Status: DONE — APPLY PASS + EXACT-HEAD PR GATES PASS + PREVIEW READY + PRODUCTION READY + STATUS/UI RUNTIME PASS

Implemented:
- Added deterministic read-only `work-board` operation backed by bounded GitHub issue/comment reads.
- Work Board returns sanitized issue identity/title/url, priority/type, lifecycle stage, age/stale signal and evidence booleans; no raw issue body or comment text is returned.
- Aggregates total/active/queued/claimed/completed/failed/cancelled/stale counts.
- Queued/claimed items become an attention signal after 30 minutes without issue activity; the signal performs no mutation.
- `Công việc` now reads system GitHub Source of Truth instead of only browser-local tracking.
- AI Gateway failure points to explicit `Giao việc` fallback without silently creating work.
- Persistent Queue Hygiene CI verifies the Work Board UI invariant.

Evidence:
- Initial apply run `33312345949`: all product syntax/helper/UI/build checks PASS; only generated push failed because the GitHub Actions token lacked workflow-update permission.
- Root cause fixed by separating persistent workflow mutation into the connected GitHub control channel.
- Apply run `33312474076`: PASS.
- Final exact head `451773d1da6d03a5f102f19a7adc4336891bd25d` contained only product/test/doc/persistent-gate changes; one-time bootstrap files were removed.
- Exact-head Preview `dpl_8paVtUvu5bYTtY4cNttvUmiAMnvP`: READY.
- PR #73 exact-head gates: CI `33312567412` PASS; Queue Hygiene `33312567395` PASS; Vercel Verify `33312567410` PASS.
- PR #73 merged as `d687e3d74eebc3c463d4fe943445857c19576e02`.
- Production deployment `dpl_BeGwJ9BNpTNfueU4wLZ5UVyFkFGU`: READY.
- Production `/api/control`: HTTP 200 with `workBoard=true`, `explicitDispatch=true`; queue remains exactly #57/#58.
- Production `/`: HTTP 200 and contains the Work Board UI path plus the explicit `Giao việc` fallback hint.
- A direct Production POST to `operation=work-board` was not performed by the available remote GET verifier; the operation is covered by exact-head helper/UI/build gates and deployed Production code.

## WO-018 — Retry-safe lifecycle ordering

Status: DONE — APPLY PASS + EXACT-HEAD PR GATES PASS + PREVIEW READY + PRODUCTION READY + STATUS RUNTIME PASS

Implemented:
- Lifecycle evidence now recognizes exact marker tokens at the beginning of trimmed comment lines instead of arbitrary substring mentions in diagnostic prose/code.
- Lifecycle events are ordered by GitHub comment timestamp with stable input-order fallback when timestamps are unavailable.
- Open issues use the latest real lifecycle event, so `claim → fail → claim` reports `claimed` and `fail → result` reports `completed`.
- Historical evidence booleans still preserve whether claim/result/failure were ever observed; current `stage` no longer lets an old FAILED marker permanently dominate a later retry.
- Closed duplicate/not_planned issues remain `cancelled`; other closed issues remain `completed`.
- PC01 status now uses the same shared lifecycle classifier as `work-order-status` and Work Board.

Evidence:
- Real #57 history contains an initial claim, an historical failure and later recovery discussion, demonstrating why permanent historical-failure dominance was unsafe.
- Apply run `33312826563`: PASS for syntax, retry-order tests, queue/Work Board invariants, UI and build.
- Final exact head `f53a1d82a6bd570619b0ef3386aebaf951664fd9` contained only API/test/doc changes; one-time patcher/workflow were removed.
- Exact-head Preview `dpl_FCQrP9EUu5ZSP6WLRB7WVPqoKT7P`: READY.
- PR #74 exact-head gates: Queue Hygiene `33312960795` PASS; Vercel Verify `33312960796` PASS; CI `33312960802` PASS.
- PR #74 merged as `ba059c59dc13c91a4c7f2abc26b2a1ad8afd164b`.
- Production deployment `dpl_5cjyVfkGJ2wPLsBLCXhGF9nU9Yuj`: READY.
- Production `/api/control`: HTTP 200; deterministic capabilities preserved; queue remains exactly #57/#58.
- #58 still has no lifecycle comments, so PC01 correctly remains `offline`; WO-018 makes no PC recovery claim.

## External blocker

One Vercel account action is still required only for conversational GPT inference: add/confirm a valid credit card for the Vercel AI Gateway. This does not block deterministic Web Control, explicit Work Order dispatch, GitHub queue management, dedupe, lifecycle tracking, Work Board, PWA operation, or status reads.

After billing is later confirmed, rerun the Production Chief smoke. Required evidence: `mode=reply` for `Bạn đang sử dụng mô hình nào để trao đổi với tôi?` + real `modelUsed/providerUsed` + no GitHub Work Order created.
