# NV04 Gemini API Integration — PC01 — 2026-09-08

## Scope
- Lane: #392 / NV04 Khải / PR #513.
- Branch: `nv04/ai-api-runtime-integration-20260908`; OFF-MAIN only.
- No Production, reboot, payment, billing activation, credential replacement, or security widening.

## Zero-cost boundary and model choice
- Persistent Gemini credential and Free Tier proof were verified present without logging the secret.
- Proof remains plan `Free`, price `0`, `billingLinked=false`, `paidFallbackAllowed=false`, expiry 2026-10-08 UTC.
- Google pricing checked 2026-09-08 lists `gemini-3.5-flash` and `gemini-3.5-flash-lite` Standard Free Tier input/output as free of charge.
- Live `gemini-3.5-flash` initially passed, then reached Free Tier request quota 20.
- `gemini-3.5-flash-lite` was independently live-probed with the same credential and returned the required marker successfully.
- Safe default was therefore repinned to stable `gemini-3.5-flash-lite`, optimized by Google for high-throughput execution, with the same explicit Free Tier/no-billing guard.
- Model Router, Inference Gateway and PC01 AI Coordinator now pin only `gemini-3.5-flash-lite`; unknown model or missing/unsafe proof fails closed before provider use.
- Official sources: `https://ai.google.dev/gemini-api/docs/pricing`, `https://ai.google.dev/gemini-api/docs/models`, `https://ai.google.dev/gemini-api/docs/rate-limits`.

## Live provider and router evidence
- Direct runtime call PASS: `gemini/gemini-3.5-flash-lite`, Free Tier proof true, paid fallback false.
- Live router job PASS: primary `gemini/gemini-3.5-flash-lite`, one attempt, marker matched, no fallback.
- Coordinated mixed checkpoint PASS/`verified`: Groq `openai/gpt-oss-120b` executor → Gemini `gemini-3.5-flash-lite` reviewer `PASS` → Ollama `qwen3:8b` judge `PASS`; output SHA-256 values were recorded without persisting provider secrets.
- The broader two-scenario harness later exceeded a 90-second watchdog only after entering its separate local-only fallback scenario; the mixed cloud/local coordinated checkpoint had already reached `verified`. No NV04 process remained after watchdog cleanup.
- Earlier live 503 `UNAVAILABLE` was bounded and later succeeded.
- Live 429 on `gemini-3.5-flash` was classified as `quota`; router immediately fell back to Groq `openai/gpt-oss-120b` and returned successfully.
## Resilience and integration verification
- Added deterministic coverage for HTTP 429 → `quota`, HTTP 503 → `outage`, bounded timeout → `timeout`, and fallback after quota without retry loop; 3/3 PASS.
- Existing Gemini/Gateway/PC01 routing tests were updated to the exact new model pin.
- Final full regression after the `gemini-3.5-flash-lite` repin: 30 files / 146 tests PASS.
- TypeScript typecheck/build, `test-ai-free-policy.ps1`, and `git diff --check` PASS after correcting stale model assertions.
- Gemini remains inside the existing Model Router / Inference Gateway / PC01 `CoordinatedAiProvider`; the live harness is evidence-only and does not create a second runtime route.
- Coordinated provider-diversity path remains Groq executor → Gemini reviewer → Ollama judge when all three are eligible.

## Acceptance
- Persistent credential reuse without disclosure: PASS.
- Current Free Tier model selected and pinned with paid fallback denied: PASS.
- Direct Gemini API call: PASS.
- Router → Gemini → response live E2E: PASS.
- Timeout/API/quota classification and bounded fallback: PASS.
- MAIN/Production/payment/billing/security boundary untouched: PASS.

STATE: `GEMINI_FREE_ONLY_LIVE_ROUTER_E2E_PASS_DEFAULT_GEMINI_3_5_FLASH_LITE_RESILIENCE_PASS_OFF_MAIN`
