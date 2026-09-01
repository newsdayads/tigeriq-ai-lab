# CURRENT STATE — WO-047 API-FIRST INFERENCE GATEWAY

Date: 2026-09-01  
Status: COORDINATOR DEPENDENCY REFRESHED — AUTOMATED GATE PASS AT MERGE HEAD — FINAL DOC HEAD REGATE / INDEPENDENT REVIEW PENDING  
Branch: `wo047/api-first-inference-gateway`  
PR: #127  
Issue: #125

## Working repository capability
- TigerIQ Employee Identity is independent from provider/model backend identity.
- Contract exists for APP and Work Management consumers without modifying their implementations.
- Short-lived authenticated TigerIQ device sessions protect inference calls.
- Gemini + Groq are primary configured backend families in this Gateway; OpenRouter is bounded fallback.
- Provider credentials stay server-side.
- Provider quota/429, outage, timeout, auth/configuration and invalid responses are classified.
- Health/cooldown and request-unit budgets affect selection.
- Route retries are bounded to a maximum of 3.
- Reviewer/Judge backend identity independence excludes prior identities and fails closed when unavailable or prior identity context is missing.
- Mock-device E2E proves session -> inference -> sanitized evidence and idempotent replay.

## 2026-09-01 coordinator dependency refresh
PR #111 changed after the prior WO-047 gate to require three distinct Executor/Reviewer/Judge provider-model identities for every coordinated work item.

WO-047 was refreshed without force/rebase by merge commit `83fe3c05e6b8d40e36a3fca8ae3c167676df0f96` with parents:
- prior WO-047 head `6c8d006054c04330d353a61acacc7107d53bf4e7`;
- current WO-043 coordinator head `9f517c12168ffc9f69c62c18da711b1de9bf6efc`.

The old WO-047 side added 11 Gateway-only files and did not overlap the five files changed by the WO-043 three-way remediation. The merge therefore preserved both sides without modifying Android, Web Control, PC01 runtime, MAIN or Production.

Automated evidence at merge head `83fe3c0...`:
- CI `33532723535`: PASS.

This CURRENT_STATE synchronization is a new documentation commit, so the final exact documentation head must pass CI again before automated gate status is final.

## Independent review boundary
The independent review that passed the former exact WO-047 head is historical after the dependency refresh. A genuinely independent review bound to the final exact refreshed head is required. Same-author/self-review is not independent evidence.

## Not claimed
- No live Gemini/Groq/OpenRouter credentials or cloud inference proof.
- No live PC01 provider/auth/quota result.
- No global/multi-instance durable provider budget, health or idempotency state.
- No cryptographically signed chain of prior Reviewer/Judge backend evidence.
- No APP/Android/PC01/Web Control implementation change.
- No MAIN/Production release.

## Integration boundaries
- APP consumes the documented session/inference contract and never receives provider credentials.
- Work Management carries trusted prior `provider/model` evidence via `requiredDistinctFrom`; it does not own provider credentials or mutate Gateway health/budget state.
- Existing Workforce NodeScope does not yet include `inference:invoke`; deployment integrates through the injected bootstrap-authentication boundary under the owning stream's authorization.
- PR #131 remains owned by its cross-stream/Android integration gate and must not be mutated by this AI Coordinator stream.