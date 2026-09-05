# WO-047 — API-first TigerIQ Inference Gateway

Priority: P0  
Status: ENGINEERING IMPLEMENTED ON FEATURE BRANCH — FINAL EXACT-HEAD GATE / INDEPENDENT REVIEW REQUIRED  
Date: 2026-08-31  
Issue: #125  
PR: #127  
Branch: `wo047/api-first-inference-gateway`

## Scope
04 — Bộ điều phối AI server-side Gateway/Inference only.

Explicitly excluded:
- APP implementation
- PC01 runtime
- Web Control
- Work Management implementation
- MAIN / Production

## Architectural invariant
TigerIQ owns Employee Identity. Provider/model is only an execution backend.

The client authenticates to TigerIQ and receives a short-lived TigerIQ inference session. Gemini/Groq/OpenRouter credentials remain server-only and are never returned to the client.

## Baseline audit
### PR #111 / WO-043
Base exact head: `1f8261c59b6406a471226a762a3b724d5dad93dd`.
WO-043 has independent repository/engineering PASS for task-aware coordination, bounded fallback, checkpoint recovery and concrete backend identity separation.

### MAIN model-router
`packages/model-router` currently:
- supports Provider union values including `openrouter`;
- has concrete adapters for OpenAI, Anthropic, Gemini and Ollama;
- does not have a Groq provider/adapter;
- does not implement an OpenRouter HTTP adapter;
- uses a separate historical OpenAI -> Anthropic -> Gemini -> Ollama routing policy.

Decision: do not destabilize the already-reviewed WO-043/model-router surface. WO-047 adds a dedicated server-side `packages/inference-gateway` layer with the new API-first provider policy.

### Existing TigerIQ device identity
The Workforce Controller already has TigerIQ-owned node credentials and bearer authentication. Its current NodeScope contract does not include `inference:invoke`. WO-047 therefore exposes an injected `BootstrapAuthenticator` boundary and does not modify Workforce/Work Management scope ownership.

## Contract first
Before runtime code, WO-047 added:
- `docs/contracts/AI_INFERENCE_GATEWAY_V1.md`
- `schemas/ai-inference-gateway-v1.schema.json`
- Milestone 1 evidence.

Shared consumer contract:
- `POST /v1/inference/sessions`
- `POST /v1/inference`
- `GET /v1/inference/health`

02 APP can authenticate and invoke without provider keys. 06 Work Management can submit role/task/risk/acceptance and carry prior backend identities for independent verification without owning provider credentials or health state.

## Delivered Gateway core
### Provider policy
Primary tier:
1. Gemini
2. Groq

Fallback tier:
3. OpenRouter

### Server-only provider adapters
- Gemini generateContent.
- Groq OpenAI-compatible chat completions.
- OpenRouter chat completions.

Credentials are read from server configuration only.

### Provider health and quota
- healthy / degraded / cooling_down states;
- classified quota/429, outage, timeout, auth, configuration and invalid-response failures;
- Retry-After aware quota cooldown;
- bounded failure cooldown;
- process-local deterministic request-unit budgets and budget windows.

### Bounded fallback
- hard server maximum: 3 route attempts;
- caller may request fewer attempts, never more;
- no infinite retry;
- exhausted routes return sanitized `ROUTES_EXHAUSTED` evidence.

### Independent Reviewer/Judge
- exclusion is based on concrete `provider/model` backend identity;
- Reviewer requires prior backend identity evidence;
- coding/high-risk Judge requires two prior backend identities;
- unavailable independent backend fails closed instead of silently reusing an identity.

### Short-lived device calls
- HMAC-SHA256 signed TigerIQ session token;
- default TTL 5 minutes;
- hard maximum TTL 15 minutes;
- binds employee/node/optional device/scope;
- no provider credential in token claims;
- inference request employee must equal session employee.

### Idempotency
HTTP inference requires `Idempotency-Key`. Same identity + key + request replays the cached result inside the server process and does not repeat provider execution. Reusing the key for a different request is rejected.

## Verification
Tests cover:
- Gemini quota/429 -> Groq fallback;
- provider outage fallback;
- retry cap;
- provider budget exhaustion;
- high-risk 3-backend Executor/Reviewer/Judge independence;
- independence unavailable fail-closed;
- missing prior identity context fail-closed;
- device session mint/verify/expiration;
- Groq real mocked HTTP 429 + Retry-After classification;
- Gemini/Groq/OpenRouter request shapes;
- mock-device HTTP session -> inference -> evidence;
- provider credential redaction;
- employee identity mismatch;
- Idempotency-Key replay without second provider call.

Implementation/schema exact head `1fdaf38ce0c56e0c16f3b4bd254f935393302144` passed CI `33367955273`; job `99412474419` passed PowerShell syntax, Install, Typecheck, Unit tests, Playwright smoke and Build.

## Security boundaries
- No provider secret/token committed.
- No endpoint returns provider keys, authorization headers, environment values or raw upstream error bodies.
- Evidence contains backend identity, bounded outcome/failure class and output SHA-256.
- Unknown backend exceptions are converted to sanitized outage evidence.
- HTTP responses are no-store and include restrictive security headers.

## Known deployment boundaries
1. Bootstrap integration: Workforce NodeScope currently has no `inference:invoke`; deployment must implement the injected authenticator without weakening the existing Workforce ownership boundary.
2. Prior-stage chain: `requiredDistinctFrom` is supplied by the trusted orchestration/Work Management caller. Cryptographic chaining of prior evidence is not claimed in v1.
3. Budget/health/idempotency state is process-local. Multi-instance Production requires a shared durable store for global enforcement.
4. No live provider credentials, live cloud semantic call, billing or provider availability is claimed by repository tests.

## Release boundary
PR #127 remains draft and stacked on PR #111. No MAIN/Production merge or deployment is authorized by WO-047. Final exact-head automated gate and independent review are required before engineering DONE; normal Owner release authorization remains separate.