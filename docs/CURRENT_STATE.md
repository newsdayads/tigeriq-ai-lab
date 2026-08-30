# Current State

Date: 2026-08-30

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production baseline

- MAIN: `1dd301187f0430f54c615110a87b3850125f6b77`.
- Production deployment: `dpl_FyLgrc8Lx1vLzyg6uHKS6vRdrPwu`, READY.
- Vietnamese mobile-first chat UI is preserved.
- Browser-scoped GitHub authorization has been runtime verified by successful Web Control writes; issues #61 and #62 were created from the web flow.
- Deterministic Vercel/GitHub/status operations remain tool-first and do not call an LLM.
- PC01 remains offline and is outside WO-013.

## WO-013 — Vercel AI Gateway Model Router

Status: IMPLEMENTED ON PREVIEW; PRODUCTION NOT PROMOTED YET

Branch: `wo013/vercel-ai-model-router`.
Latest implementation commit before this state update: `133991b2621b565cd980e1be7ea5a7ff0a6fe4ac`.
Preview deployment: `dpl_8soRhwNDjzRp9x2hiXLLpfHrmtu8`, READY.

Implemented:
- Vercel AI Gateway router using deployment `VERCEL_OIDC_TOKEN`; no provider secret committed.
- Explicit bounded model fallbacks by role.
- Cost-aware Chief of Staff route starts with a fast Google model; stronger implementation route is reserved for Executor.
- Roles declared: Chief of Staff, Executor, Independent Reviewer, Judge/Gate.
- Reviewer primary differs from Executor primary; Judge is a separate role and does not replace deterministic CI/test gates.
- 20-second bounded model request timeout and explicit rate-limit error classification.
- Model evidence includes role, requested model, fallback models, actual model returned by Gateway and usage when available.
- `/api/control` exposes router configuration state and sends ordinary conversational chat through Chief of Staff while deterministic status/capability operations stay non-LLM.
- Explicit execution verbs continue to create durable GitHub Work Orders rather than allowing an LLM to perform untracked writes.
- ADR `0012-vercel-ai-gateway-router.md` records architecture, failure policy and promotion gate.

Not yet verified:
- Preview is protected by Vercel Authentication; connector fetch cannot establish the browser SSO cookie, so a live POST through the protected Preview has not yet produced AI Gateway runtime evidence.
- No GitHub Actions run exists for this branch yet because current workflow triggers do not cover this branch.
- Therefore MAIN/Production promotion is intentionally blocked until runtime AI response plus applicable test/CI evidence are obtained.

## Next gate

1. Obtain live Preview runtime evidence for `/api/control` AI conversation and confirm OIDC AI Gateway authentication/provider routing.
2. Add/execute branch test coverage for deterministic-vs-AI classification and bounded failure behavior.
3. Add durable Work Order model metadata and independent Reviewer/Judge gate evidence for model-assisted execution.
4. Promote to MAIN/Production only after Preview + tests + runtime all PASS.
