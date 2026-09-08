# NV04 Gemini API Integration — PC01 — 2026-09-08

## Scope
- Lane: #392 / NV04 Khải / PR #513.
- Branch: `nv04/ai-api-runtime-integration-20260908`.
- OFF-MAIN only; no Production, reboot, payment, billing activation, or security widening.

## Zero-cost boundary
- Gemini API route is enabled only behind explicit Free Tier proof plus API key.
- Allowed model is pinned to `gemini-2.5-flash`.
- Unknown/missing Free Tier proof fails closed before any network request.
- `billingLinked=true` or `paidFallbackAllowed=true` is rejected.
- Google official pricing source checked 2026-09-08: Gemini 2.5 Flash Free Tier lists input and output as free of charge.
- Official source: `https://ai.google.dev/gemini-api/docs/pricing`.

## Implementation
- Hardened Gemini adapters in Model Router and Optional Inference Gateway.
- Added Gemini Free Tier policy to `config/ai-free-providers-v1.json`.
- Added Gemini as an independent reviewer candidate in PC01 AI Coordinator.
- Added persistent DPAPI LocalMachine secret installer with SYSTEM/Administrators ACL.
- Added direct Gemini runtime verifier using `x-goog-api-key`; key is not placed in URL/log/evidence.
- Extended AI API runtime deployment bundle with Gemini installer/verifier.
- Added CI/static guards for DPAPI, billing-unlinked proof, paid-fallback denial, pinned model, and pre-network secret gate.

## Verification
- Targeted Gemini/Groq/Gateway/PC01 tests: 35/35 PASS.
- Full Vitest: 29 files / 143 tests PASS.
- TypeScript build: PASS.
- `test-ai-free-policy.ps1`: PASS.
- PowerShell parser: installer and runtime wrapper PASS.
- PC01 secret audit: `gemini-api-key.dpapi` absent; `gemini-free-tier-proof.json` absent.
- Direct runtime verifier therefore stopped at `GEMINI_RUNTIME_SECRET_MISSING`; no Gemini network call executed.

## Remaining physical credential gate
- Live Gemini API E2E is not claimed.
- Required once: a Gemini API key belonging to a project confirmed Free Tier with no billing/PAYG linkage.
- Install through hidden local prompt only; never paste the key into chat, Git, logs, or evidence.
- After install: direct Gemini live verifier, then Groq → Gemini → Ollama coordinated E2E and evidence capture.

STATE: `GEMINI_FREE_ONLY_CODE_AND_GUARDS_PASS_SECRET_AND_FREE_TIER_PROOF_PENDING_LIVE_E2E_NOT_CLAIMED`
