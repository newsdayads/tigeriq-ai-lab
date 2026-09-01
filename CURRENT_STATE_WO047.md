# CURRENT STATE — WO-047 API-FIRST INFERENCE GATEWAY

Date: 2026-09-01  
Status: FINAL COORDINATOR DEPENDENCY REFRESHED — EXACT-HEAD REGATE / GENUINE INDEPENDENT REVIEW PENDING  
Branch: `wo047/api-first-inference-gateway`  
PR: #127  
Issue: #125

## Working repository capability
- TigerIQ Employee Identity is independent from provider/model backend identity.
- Contract exists for APP and Work Management consumers without modifying their implementations.
- Short-lived authenticated TigerIQ device sessions protect inference calls.
- Provider credentials stay server-side.
- Provider quota/429, outage, timeout, auth/configuration and invalid responses are classified.
- Health/cooldown and request-unit budgets affect selection.
- Route retries are bounded to a maximum of 3.
- Reviewer/Judge backend identity independence excludes prior identities and fails closed when unavailable or prior identity context is missing.
- Mock-device E2E proves session -> inference -> sanitized evidence and idempotent replay.

## 2026-09-01 final coordinator dependency refresh
PR #111 final engineering head `b204e6cb581feebc10ff400aa5a5bcc1296bbc74` now requires three distinct Executor/Reviewer/Judge identities for every Work Order and defaults to Ollama local + `openrouter/free`, failing closed instead of auto-selecting generic paid/unproven API routes.

WO-047 was refreshed without force/rebase by merge commit `f748276f0441f99108a6ec53ec94a1790bf478f0` with parents:
- prior WO-047 head `56fe223629d9994f25723cd6b20265868de901a5`;
- current WO-043 head `b204e6cb581feebc10ff400aa5a5bcc1296bbc74`.

Compare evidence showed the WO-047 side only adds its 11 Gateway-owned files relative to the current WO-043 base; no WO-043 remediation file is overwritten. The merge therefore preserves both sides without modifying Android, Web Control, PC01 runtime, MAIN or Production.

Historical refresh evidence:
- first merge `83fe3c05e6b8d40e36a3fca8ae3c167676df0f96`: CI `33532723535` PASS;
- first doc head `56fe223629d9994f25723cd6b20265868de901a5`: CI `33532871570` PASS.

The final merge/documentation head created after `f748276...` must receive a fresh exact-head CI. Historical PASS is not used as substitute.

## Independent review boundary
Earlier independent review results are historical after dependency refresh. A genuinely independent review bound to the final exact refreshed head is required. Same-author/self-review is not independent evidence.

## Billing/runtime truth boundary
- WO-047 does not prove billing-safe Gemini/Claude account login by itself; that policy/probe belongs to #133/#134.
- No live Gemini/Claude/OpenRouter/Ollama result is claimed.
- No PC01 auth/quota/scheduler/restart result is claimed.
- Provider budget/health/idempotency remain process-local in this Gateway implementation.

## Not changed
- No APP/Android implementation.
- No PC01 runtime.
- No Web Control.
- No MAIN/Production.
- No credential/key/payment method.

## Integration boundaries
- APP consumes the documented session/inference contract and never receives provider credentials.
- Work Management carries trusted prior `provider/model` evidence via `requiredDistinctFrom`; it does not own provider credentials or mutate Gateway health/budget state.
- Existing Workforce NodeScope does not yet include `inference:invoke`; deployment integrates through the injected bootstrap-authentication boundary under the owning stream's authorization.
- PR #131 remains owned by its cross-stream/Android integration gate and must not be mutated by this AI Coordinator stream.
