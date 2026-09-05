# WO-047 Milestone 2 Evidence — Gateway Core

Date: 2026-08-31  
Branch: `wo047/api-first-inference-gateway`  
PR: #127 (draft, stacked on PR #111)  
Issue: #125

## Result
PASS — repository/engineering gate for Gateway core.

## Audit findings that drove the design
- PR #111 at base exact head `1f8261c59b6406a471226a762a3b724d5dad93dd` already has independent PASS for task/risk/cost-aware coordination, bounded retries, checkpoint recovery and backend identity separation.
- MAIN `packages/model-router` supports OpenAI, Anthropic, Gemini and Ollama adapters; its provider type mentions OpenRouter but has no OpenRouter HTTP adapter, has no Groq provider/adapter, and its default route is OpenAI -> Anthropic -> Gemini -> Ollama.
- WO-047 therefore adds a separate server-side `packages/inference-gateway` adapter/policy layer instead of destabilizing the already-reviewed WO-043 coordinator or changing Work Management.

## Implemented
- TigerIQ employee identity remains independent from provider/model backend identity.
- Gemini + Groq are primary-tier backends; OpenRouter is fallback-tier.
- Server-only provider adapters:
  - Gemini `generateContent` with `x-goog-api-key`.
  - Groq OpenAI-compatible `/chat/completions` with server-side bearer key.
  - OpenRouter `/chat/completions` with server-side bearer key.
- Provider failure classification: quota/429, outage, timeout, auth, invalid response, configuration.
- Health state: healthy / degraded / cooling_down with bounded cooldown.
- Budget guard: deterministic request units per provider and resettable budget window.
- Hard route cap: maximum 3 attempts; client can request a lower cap but never a higher one.
- Reviewer/Judge candidate exclusion by concrete `provider/model` backend identity; missing independence context fails closed.
- Evidence exports backend identity, outcome/failure class and SHA-256 output digest only; arbitrary upstream exception text is not exported.
- Short-lived TigerIQ session token uses HMAC-SHA256, default 5 minutes and hard maximum 15 minutes; claims bind employee/node/optional device and never contain provider credentials.

## Exact-head automated proof
Head: `1fdaf38ce0c56e0c16f3b4bd254f935393302144`

GitHub Actions CI run `33367955273`: PASS.
Job `99412474419`: PASS for:
- PowerShell syntax
- Install
- Typecheck
- Unit tests
- Playwright smoke
- Build

## Truth boundary
- No live Gemini/Groq/OpenRouter credential is configured or called by this evidence.
- Budget/health state in this repository implementation is process-local. A shared durable state adapter is a Production-scale deployment concern and is not claimed by this branch.
- No MAIN/Production change.