# Current State

Date: 2026-08-30

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production baseline

- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- MAIN includes PR #65 / WO-013 Chief-of-Staff chat publication and PR #66 / WO-014 queue hygiene hardening.
- Production `/api/control` public status: HTTP 200; Vercel and GitHub report online.
- PC01/OpenClaw/Ollama were not modified by WO-013/014.

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
- Vercel OIDC is obtained using the official `@vercel/oidc` runtime helper; no provider secret is committed.
- Chief static router tests and repository CI PASS on the WO-013 branch.
- PR #65 merged to `main`; Production deployment is READY.

Runtime evidence:
- Production status endpoint verified HTTP 200 after publication.
- Bounded Production Chief smoke reached Vercel AI Gateway successfully but Gateway returned HTTP 403 with an explicit account requirement: a valid credit card must be on file before AI Gateway will service requests/free credits.
- Therefore no model inference has completed yet and no claim of conversational runtime PASS is permitted.

## WO-014 — Web Control queue hygiene

Status: DONE — CI PASS + PREVIEW READY + PRODUCTION READY + RUNTIME STATUS PASS

Implemented:
- Deterministic Work Order fingerprinting for duplicate prevention.
- Repeated identical open execution requests return the existing Work Order instead of creating another issue.
- Read-only `work-order-status` API reports queued / claimed / completed / failed stages from issue state and evidence comments.
- `/api/control` advertises `workOrderDedupe=true` and `workOrderStatusTracking=true`.
- Test/misclassified/duplicate Web Control issues #61, #62, #63 and duplicate canary #64 were closed with closure evidence.
- Canonical PC01 recovery/canary tracking remains #57 and #58.
- Dedicated CI workflow `WO-014 Queue Hygiene` run `33310868581` PASS.
- Vercel Preview for branch `wo014/web-control-queue-hygiene` READY.
- PR #66 merged to `main` as `fd7c5d6cd4c855ad171b162578527d4caff6dd9a`.
- Production deployment `dpl_7h5BiD424fGX4o85AUuHg8YwG6tU` READY.
- Production `GET /api/control` returned HTTP 200 with Vercel online, GitHub online, PC01 offline, and queue reduced to the canonical PC01 issues.

## External blocker

One Vercel account action is still required only for conversational model inference: add/confirm a valid credit card for the Vercel team/project AI Gateway. This does not block deterministic Web Control, GitHub queue management, status reads, dedupe, or Work Order tracking.

After billing is later confirmed, rerun the Production Chief smoke. Required terminal evidence:

`mode=reply` for the question `Bạn đang sử dụng mô hình nào để trao đổi với tôi?` + real `modelUsed/providerUsed` + no GitHub Work Order created.
