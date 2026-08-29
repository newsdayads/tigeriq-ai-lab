# WO-009 — Multi-AI Provider Mesh

Priority: P0
Status: IMPLEMENTED — CI / INDEPENDENT REVIEW GATE PENDING
Date: 2026-08-29

## Goal
Route TigerIQ execution through configurable cloud providers OpenAI → Claude/Anthropic → Gemini and automatically fall back to PC01 Ollama when cloud providers are unavailable, rate-limited, quota-limited, misconfigured, or timing out.

## Scope
- Keep the provider-neutral `ModelRouter` and bounded circuit breaker.
- Add native HTTP adapters for OpenAI, Anthropic/Claude, and Gemini.
- Preserve the existing loopback Ollama OpenAI-compatible adapter for PC01.
- Use environment/options for API keys and model IDs; never commit credentials.
- Classify provider failures (`quota`, `outage`, `timeout`, `auth`, `configuration`, `invalid_response`).
- Open circuits immediately for quota/outage/timeout/auth/configuration failures to avoid repeated failing cloud calls.
- Record bounded attempt metadata without prompts or credentials.
- Keep MAIN/Production untouched.

## Default route
1. OpenAI cloud
2. Claude/Anthropic cloud
3. Gemini cloud
4. Ollama local on PC01

Model IDs are not hard-coded because provider model catalogs change. Configure them with:
- `TIGERIQ_OPENAI_MODEL`
- `TIGERIQ_ANTHROPIC_MODEL`
- `TIGERIQ_GEMINI_MODEL`
- `TIGERIQ_OLLAMA_MODEL`

Provider credentials remain outside the repository:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

## Acceptance criteria
- Cloud adapters parse their native response formats.
- Provider credentials are sent only in request headers and never included in routing evidence.
- HTTP 429 is classified as quota and falls through to the next provider; the circuit suppresses immediate retries.
- HTTP 5xx/network failures are classified as outage and fall through.
- Timeouts fall through without losing Work Order state.
- If every cloud route fails, configured PC01 Ollama can execute the request.
- Total route exhaustion fails closed.
- Typecheck, unit tests, Playwright smoke and build pass in GitHub Actions.
- Independent review/judge gate is required before any merge or Production use.

## Safety
No paid subscription or credential provisioning is authorized by this Work Order. No secret may enter source control, issue text, evidence, or Trello. No MAIN/Production mutation is authorized.
