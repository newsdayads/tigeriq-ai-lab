# WO-047 Milestone 3 Evidence — Mock-device E2E + Failure Paths

Date: 2026-08-31  
Branch: `wo047/api-first-inference-gateway`  
PR: #127  
Issue: #125

## Result
PASS — repository/mock-runtime evidence.

## Mock-device E2E proven
1. Mock TigerIQ node/device bootstrap credential is authenticated through the injected bootstrap-authenticator boundary.
2. Gateway mints a short-lived TigerIQ session token bound to `employeeId` + `nodeId` + optional `deviceId`.
3. Device calls `POST /v1/inference` using only the short-lived TigerIQ token and Idempotency-Key.
4. Server-side Gemini adapter receives the provider credential internally.
5. Client response returns TigerIQ employee identity, result and sanitized backend evidence only.
6. Provider credential and bootstrap credential do not appear in session response, inference response, health response or exported attempt evidence.
7. Replaying the same Idempotency-Key + same request returns the cached result and does not call the provider a second time.
8. Session employee mismatch versus inference request fails with `409 IDENTITY_MISMATCH` before provider execution.

## Failure-path tests proven
- Gemini quota / 429 classification -> provider enters cooldown -> bounded fallback to Groq.
- Provider outage -> bounded fallback to next healthy eligible backend.
- Requested retry cap lower than server maximum is honored; server hard maximum is 3.
- All capable provider budgets at zero -> `429 GATEWAY_BUDGET_EXHAUSTED` before any provider call.
- High-risk coding flow can use three concrete backend identities: Gemini Executor -> Groq Reviewer -> OpenRouter Judge.
- Reviewer with only its prior backend available -> `409 INDEPENDENT_BACKEND_UNAVAILABLE`.
- Reviewer missing prior identity evidence and high-risk Judge missing two prior identities -> fail closed with `INVALID_REQUEST`.
- Real mocked HTTP 429 from Groq adapter is classified as quota and honors `Retry-After`.
- Arbitrary upstream exception text is not included in Gateway evidence.

## CI evidence for implementation head
Implementation/schema head: `1fdaf38ce0c56e0c16f3b4bd254f935393302144`.

CI run `33367955273`: PASS.  
Job `99412474419`: PASS for PowerShell syntax, Install, Typecheck, Unit tests, Playwright smoke and Build.

The unit gate includes:
- `tests/inference-gateway.test.ts`
- `tests/inference-gateway-device-e2e.test.ts`

## Important truth boundaries
- This is mock-device/mock-provider repository proof, not a live Gemini/Groq/OpenRouter billing or availability claim.
- `requiredDistinctFrom` is validated and enforced by the Gateway, but prior-stage identities are supplied by the trusted orchestration/Work Management caller. WO-047 does not claim cryptographic chaining of prior stage evidence.
- Health/budget and HTTP Idempotency-Key cache are process-local in this branch. Multi-instance global enforcement requires a shared durable store at deployment time.
- No APP, PC01 or Work Management implementation was changed.
- No MAIN/Production release.