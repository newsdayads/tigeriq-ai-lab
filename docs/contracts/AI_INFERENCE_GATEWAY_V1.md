# TigerIQ AI Inference Gateway Contract v1

Status: CONTRACT FIRST — implementation target for WO-047  
Owner stream: 04 — Bộ điều phối AI  
Consumers: 02 — APP, 06 — Work Management  
Release boundary: feature branch only; no MAIN/Production

## 1. Architectural invariant

TigerIQ owns employee identity. A provider/model is only an execution backend and MUST NOT become the employee identity.

Client-visible identity is always `employeeId` / `nodeId` / optional `deviceId`. Provider credentials exist only in the Gateway server environment and MUST NEVER be returned to APP, Work Management, Web Control, PC01, logs, evidence exports, or error bodies.

Provider/model names may appear only as non-secret backend identity metadata in evidence so independent Reviewer/Judge policy can be verified. They never authorize a request.

## 2. Provider policy

Primary tier:
1. Gemini
2. Groq

Fallback tier:
3. OpenRouter

The Gateway may choose between healthy primary candidates using capability, role, budget and recent provider health. OpenRouter is a bounded fallback, not an employee identity.

No client may send a provider API key. No request field may override a server credential.

## 3. Authentication model

### 3.1 Bootstrap -> short-lived session

`POST /v1/inference/sessions`

The caller authenticates with an existing TigerIQ device/node credential through the server's injected bootstrap authenticator.

Required headers:
- `Authorization: Bearer <TigerIQ node/device credential>`
- `X-TigerIQ-Credential-Id: <credential id>`

Request:
```json
{
  "employeeId": "EMP-001",
  "nodeId": "NODE-ANDROID-001",
  "deviceId": "optional-stable-device-id",
  "requestedScopes": ["inference:invoke"],
  "client": {
    "name": "tigeriq-app",
    "version": "1.0.0"
  }
}
```

Response `201`:
```json
{
  "ok": true,
  "session": {
    "accessToken": "<TigerIQ short-lived token>",
    "tokenType": "Bearer",
    "employeeId": "EMP-001",
    "nodeId": "NODE-ANDROID-001",
    "deviceId": "optional-stable-device-id",
    "scopes": ["inference:invoke"],
    "expiresAt": "2026-08-31T07:20:00.000Z"
  }
}
```

Rules:
- Default TTL: 5 minutes.
- Maximum TTL: 15 minutes.
- Token is signed by the Gateway with a server-only TigerIQ session secret.
- Provider keys are never embedded in the token.
- The session is bound to `employeeId` + `nodeId` and optional `deviceId`.

### 3.2 Inference call

`POST /v1/inference`

Required headers:
- `Authorization: Bearer <short-lived TigerIQ session token>`
- `Idempotency-Key: <stable request attempt key>`

Request:
```json
{
  "requestId": "REQ-01J...",
  "employeeId": "EMP-001",
  "workId": "WO-123",
  "role": "executor",
  "task": {
    "kind": "coding",
    "risk": "high",
    "prompt": "...",
    "acceptanceCriteria": ["..."],
    "minQuality": 3
  },
  "routing": {
    "requiredDistinctFrom": [],
    "maxAttempts": 3
  },
  "budgetClass": "free-first"
}
```

Response `200`:
```json
{
  "ok": true,
  "requestId": "REQ-01J...",
  "employee": {
    "employeeId": "EMP-001"
  },
  "result": {
    "text": "...",
    "decision": null
  },
  "evidence": {
    "selectedBackendIdentity": "gemini/gemini-default",
    "attempts": [
      {
        "sequence": 1,
        "backendIdentity": "gemini/gemini-default",
        "outcome": "success",
        "failureKind": null
      }
    ],
    "outputSha256": "<64 hex>",
    "budget": {
      "class": "free-first",
      "consumedUnits": 1,
      "remainingUnits": 99
    },
    "gatewayVersion": "v1"
  }
}
```

For `reviewer` or `judge`, `result.decision` is `PASS` or `FAIL` and provider/model identity MUST satisfy `routing.requiredDistinctFrom`.

## 4. Independence contract

`routing.requiredDistinctFrom` contains backend identities already used by earlier stages, formatted `provider/model`.

Gateway rules:
- Candidate whose backend identity appears in `requiredDistinctFrom` is ineligible.
- Reviewer must be different from Executor when caller supplies Executor backend identity.
- Judge for coding/high-risk work must be different from both Executor and Reviewer when both identities are supplied.
- If independence cannot be satisfied within the bounded route set, return fail-closed `409 INDEPENDENT_BACKEND_UNAVAILABLE`; never silently reuse the same backend identity.

APP only needs to preserve/forward evidence. Work Management may use this field to enforce stage independence. Neither consumer needs provider credentials.

## 5. Quota, budget, health and bounded fallback

Each provider has server-side runtime state:
- health: healthy / degraded / cooling_down;
- consecutive failures;
- cooldown-until timestamp;
- optional provider retry-after from HTTP 429;
- request budget limit and consumed units for the active budget window.

Routing rules:
1. Exclude disabled, cooling-down, over-budget, incapable, or independence-conflicting candidates.
2. Prefer healthy Gemini/Groq primary tier.
3. On classified `429/quota`, `timeout`, `outage`, `auth`, `configuration`, or `invalid_response`, record sanitized evidence and move to the next eligible backend.
4. Maximum route attempts is server-capped at 3 even if a client asks for more.
5. No infinite retry loop.
6. If all routes are exhausted, return `503 ROUTES_EXHAUSTED` with sanitized attempt classes only.

Budget is a policy guard, not billing truth. v1 uses deterministic request units; future provider-reported token/cost accounting may refine this without changing the client identity contract.

## 6. Sanitized health endpoint

`GET /v1/inference/health`

May return provider names, model identities, health state, budget counters and cooldown timestamps. It MUST NOT return API keys, bearer tokens, authorization headers, raw upstream responses, or environment values.

## 7. Error contract

All errors use:
```json
{
  "ok": false,
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "short stable message",
    "retryable": false,
    "retryAfterMs": null
  }
}
```

Canonical mappings:
- `400 INVALID_REQUEST`
- `401 UNAUTHORIZED`
- `401 TOKEN_EXPIRED`
- `403 SCOPE_DENIED`
- `409 IDENTITY_MISMATCH`
- `409 INDEPENDENT_BACKEND_UNAVAILABLE`
- `429 GATEWAY_BUDGET_EXHAUSTED`
- `503 ROUTES_EXHAUSTED`
- `503 PROVIDER_UNAVAILABLE`

Errors MUST NOT include upstream response bodies or secret values.

## 8. Consumer responsibilities

### 02 — APP
- Obtain a short-lived TigerIQ session using the device/node credential already owned by TigerIQ.
- Call `/v1/inference` with that short-lived token.
- Never store or request Gemini/Groq/OpenRouter keys.
- Preserve `requestId`, `employeeId`, result and evidence needed for status/history.

### 06 — Work Management
- Submit role/task/risk/acceptance data through the contract; do not choose credentials.
- Carry prior `selectedBackendIdentity` values into `requiredDistinctFrom` for Reviewer/Judge gates.
- Treat `409 INDEPENDENT_BACKEND_UNAVAILABLE`, budget exhaustion, or route exhaustion as explicit blocked/retryable workflow outcomes according to its own bounded policy.
- Do not modify Gateway provider health/budget state directly.

## 9. Server-only configuration

Expected environment variables are server-side only:
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `TIGERIQ_GEMINI_MODEL`
- `TIGERIQ_GROQ_MODEL`
- `TIGERIQ_OPENROUTER_MODEL`
- `TIGERIQ_INFERENCE_SESSION_SECRET`

They MUST NOT be prefixed or packaged as public/client environment variables.

## 10. Acceptance for WO-047

Repository proof must include:
- mock-device session mint -> authenticated inference E2E;
- provider key never appears in response/evidence;
- Gemini 429 -> bounded fallback to another healthy eligible backend;
- provider outage -> fallback;
- retry cap enforced;
- budget exhaustion blocks provider selection;
- Reviewer/Judge independence fails closed when no distinct backend is available;
- evidence records sanitized backend identity/outcome/failure class and SHA-256 output digest.

Live provider credentials/charges are not required for repository proof and must not be committed.