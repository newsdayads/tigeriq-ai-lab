# Current State

Date: 2026-08-30

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production baseline

- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- Latest completed remote Work Order: WO-023 — Stale PR Hygiene.
- Vercel project `tigeriq-ai-lab` Production is READY.
- MAIN retains Chief-of-Staff chat, queue hygiene, lifecycle/PWA, explicit dispatch, evidence-first Work Board, retry-safe lifecycle ordering, Provider Mesh v2, Source-of-Truth reconciliation, and remote governance hygiene.
- Canonical PC01 execution queue remains exactly issues #57 and #58. No duplicate canary was created.
- PC01 remains outside remote-only scope; no PC01/OpenClaw/Ollama runtime recovery is claimed.

## Remote-only capability state

DONE and retained in MAIN:
- deterministic Work Order fingerprinting and duplicate prevention;
- lifecycle/status evidence and retry-safe ordering;
- explicit dispatch fallback when conversational AI is unavailable;
- evidence-first Work Board;
- mobile/PWA Web Control;
- Provider Mesh v2 engineering path: OpenAI -> Anthropic -> Gemini -> PC01/Ollama, with bounded failure classification and credential-safe evidence;
- governance reconciliation and stale-metadata cleanup;
- obsolete draft dependency-chain PR cleanup (#15/#16/#17 closed without merge).

## Latest verified evidence

WO-023 completed with exact-head CI, Queue Hygiene and Vercel verification PASS, Preview READY, merge through PR #78, and Production READY. Immutable commit/run identifiers are recorded in `docs/work-orders/WO-023-STALE-PR-HYGIENE.md` rather than duplicated here so this state file does not become stale after every safe merge.

## External blockers / deferred activation

- Conversational Chief inference through the WO-013 Vercel AI Gateway path still requires the separate Vercel account billing/card prerequisite previously observed. Remote autonomous work must not retry or request that action while the user is driving.
- Live OpenAI/Anthropic/Gemini Provider Mesh calls require authorized runtime credentials/model configuration and any applicable financial authorization. Engineering readiness does not imply live provider activation.
- PC01 issue #57 recovery and canary #58 require the PC01 execution path; remote-only work must preserve them without creating duplicate canaries.

## Next remote-only priority

Continue operator-burden reduction and Work Order/evidence reliability. Prefer mobile Web Control/PWA, safe GitHub/Vercel automation, idempotency, error handling and governance improvements that can be implemented and verified fully without PC01, secrets, billing/card actions or Driver changes.
