# Current State

Date: 2026-08-30

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production baseline

- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- MAIN includes PR #65 / WO-013 Chief-of-Staff chat, PR #66 / WO-014 queue hygiene, and PR #67 / WO-015 lifecycle + PWA hardening.
- Production `/api/control`: HTTP 200; Vercel and GitHub online.
- Current queue is exactly canonical PC01 issues #57 and #58.
- PC01 reports offline from current GitHub evidence; OpenClaw/Ollama remain unknown and were not modified by WO-013/014/015.

## WO-013 — Chief of Staff chat

Status: CODE + CI + PRODUCTION DEPLOY PASS; AI GATEWAY RUNTIME BLOCKED BY VERCEL BILLING REQUIREMENT

Implemented:
- TigerIQ AI is the single Chief-of-Staff chat entry point.
- Ordinary questions/discussion/planning route to an OpenAI-first Chief model through Vercel AI Gateway.
- Conversation history is provided to the Chief for contextual confirmations such as `Làm` / `Tiếp`.
- Status remains deterministic/tool-first and does not call an LLM.
- Ambiguous execution intent returns clarification instead of creating a Work Order.
- Only an explicit executable instruction can create one GitHub Work Order.
- AI failure is fail-safe: it does not create a Work Order.
- Vercel OIDC uses the official `@vercel/oidc` runtime helper; no provider secret is committed.

Runtime evidence:
- Production status endpoint HTTP 200.
- Production Chief smoke reached Vercel AI Gateway but returned HTTP 403 requiring a valid credit card on file before Gateway inference/free credits.
- No conversational model inference has completed yet; no runtime PASS claim is permitted.

## WO-014 — Web Control queue hygiene

Status: DONE — CI PASS + PREVIEW READY + PRODUCTION READY + RUNTIME STATUS PASS

Implemented:
- Deterministic Work Order fingerprinting and duplicate prevention.
- Repeated identical open requests return the existing Work Order instead of creating another issue.
- Read-only `work-order-status` tracks queued / claimed / completed / failed.
- Test/misclassified/duplicate issues #61, #62, #63 and duplicate canary #64 were closed with evidence.
- Canonical PC01 tracking remains #57/#58.
- PR #66 merged; Production verified HTTP 200.

## WO-015 — Web Control lifecycle + mobile/PWA hardening

Status: DONE — EXACT-HEAD CI PASS + PREVIEW READY + PRODUCTION READY + RUNTIME PASS

Implemented:
- Lifecycle stages expanded to queued / claimed / completed / failed / cancelled.
- Read-only status returns sanitized lifecycle evidence booleans (`claimed`, `result`, `failed`, `reviewPass`, `judgePass`) and never returns raw comment bodies.
- Recently created Work Orders are tracked locally in Web Control and polled every 30 seconds; stage changes appear automatically in Vietnamese chat bubbles.
- `Kiểm tra PC01` reads canonical canary #58 and never creates another canary.
- PWA/mobile metadata, manifest, standalone mode, mobile title/icon and network-only service worker added without changing Production domain.
- WO-014 dedupe/idempotency remains intact.
- No PC01/OpenClaw/Ollama mutation; no Tiger IQ Driver changes; no AI Gateway billing retry.

Evidence:
- Lifecycle verification run `33311306234`: PASS.
- Final exact head `de44326a8e5ba6528e6f9f9ddea31e11224ba367`: CI `33311507558` PASS; Queue Hygiene `33311507578` PASS; Vercel Verify `33311507577` PASS.
- Exact-head Preview `dpl_3uamS5mzVwHLLy5m54CmSaEWDGWN`: READY.
- PR #67 merged as `7f3e2bf4f0bfdd5978d94bb08e3abef63570cac6`.
- Production `dpl_3GpKncedLZRwoiGRMm4htgx4rEJZ`: READY.
- Production `/`, `/api/control`, `/manifest.webmanifest`, and `/sw.js`: HTTP 200.
- Production `/api/control` advertises `workOrderDedupe=true`, `workOrderStatusTracking=true`, `workOrderLifecycleEvidence=true`; queue remains #57/#58.

## External blocker

One Vercel account action is still required only for conversational GPT inference: add/confirm a valid credit card for the Vercel AI Gateway. This does not block deterministic Web Control, GitHub queue management, dedupe, lifecycle tracking, PWA operation, or status reads.

After billing is later confirmed, rerun the Production Chief smoke. Required evidence: `mode=reply` for `Bạn đang sử dụng mô hình nào để trao đổi với tôi?` + real `modelUsed/providerUsed` + no GitHub Work Order created.
