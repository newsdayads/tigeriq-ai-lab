# Current State

Date: 2026-08-30

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production baseline

- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- MAIN includes PR #65 / WO-013 Chief-of-Staff chat publication.
- Production `/api/control` public status: HTTP 200; Vercel and GitHub report online.
- PC01/OpenClaw/Ollama are outside WO-013 and were not modified.

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

## External blocker

One Vercel account action is required: add/confirm a valid credit card for the Vercel team/project AI Gateway. This is an account/billing authorization gate and cannot be completed safely from repository code or deployment tooling.

After that action, rerun the Production Chief smoke. Required terminal evidence:

`mode=reply` for the question `Bạn đang sử dụng mô hình nào để trao đổi với tôi?` + real `modelUsed/providerUsed` + no GitHub Work Order created.
