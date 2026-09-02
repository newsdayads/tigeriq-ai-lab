# Issue #155 — Gemini enforceable zero-spend authority research

Status: `GEMINI_ZERO_SPEND_AUTHORITY_RESEARCH_READY`
Research date: 2026-09-02
Scope: CHAT 02 / Android AI Employee only · PR #140 · research/security artifact only

## Decision

**Do not re-enable Gemini direct on PR #140. Keep `ZeroCostAuthority` fail-closed / disabled.**

Current Google documentation exposes a real provider-side non-billable project state: an AI Studio / Gemini API project that is **unlinked from Cloud Billing** is downgraded to the Free usage tier, and Cloud Billing reports a project with no billing account as `billingEnabled=false`, meaning it cannot use paid services.

However, Google does **not** document a Gemini API request flag, API-key-level billing mode, immutable `free-only` key, response attestation, or zero-dollar spend-cap mode that binds a specific inference request/key to non-billable execution at request time.

The project-level no-billing state is therefore a valid **authority source candidate**, but it is not sufficient for the current Android architecture to authorize execution because:

1. Gemini API keys have no independent billing settings; they inherit project billing state.
2. Mapping an API key to its parent project via the API Keys API requires OAuth/IAM authorization.
3. Reading authoritative project billing state via Cloud Billing `projects.getBillingInfo` also requires OAuth/IAM authorization.
4. The current phone owns only the Gemini provider credential and must not be given a long-lived privileged Cloud Billing/API Keys credential.
5. A cached/signed statement that billing was disabled at time T has a TOCTOU gap: the project can be linked to billing after attestation and before/later during provider execution.
6. Google documents billing-signal latency/possible overages for spend caps and prepaid billing; those controls cannot satisfy a strict 0đ guarantee.

Until TigerIQ has an independently enforceable, machine-verifiable runtime authority that closes the key-binding + billing-state + freshness/TOCTOU problem, Gemini direct remains `unknown/disabled` and no provider call is permitted.

## Official Google evidence

### 1. Gemini Free vs Paid is project/billing-account state, not a key-local assertion

Google Gemini API Billing documentation states:
- new accounts begin on Free Tier;
- upgrading to Paid requires linking a Cloud Billing account;
- a project can be unlinked from its billing account to return to Free Tier;
- API keys are generated inside a project, have **no independent billing settings**, and inherit the project's tier limits and billing status.

Source: https://ai.google.dev/gemini-api/docs/billing

Security consequence: a local `free_confirmed` value, checkbox, model name, or API-key string alone is not billing authority.

### 2. Disabling/unlinking billing is the provider-side hard non-billable state

Google Cloud Billing documentation states that billing is enabled only when a project is linked to an active Cloud Billing account. For Google AI Studio, disabling billing on the project downgrades the project's Gemini API billing tier to the Free usage tier with limited free access.

Source: https://docs.cloud.google.com/billing/docs/how-to/modify-project

The Cloud Billing `ProjectBillingInfo` schema defines:
- `billingAccountName`: billing account associated with the project, if any;
- `billingEnabled`: true when associated with an open billing account to which usage is charged; false when no billing account (or a closed account) is associated, and the project therefore cannot use paid services.

Source: https://docs.cloud.google.com/billing/docs/reference/rest/v1/ProjectBillingInfo

TigerIQ's strict candidate state is narrower than `billingEnabled=false`: require **unlinked** billing (`billingEnabled=false` and no `billingAccountName`), not merely a closed/suspended linked billing account.

### 3. Android cannot directly verify that authority with only the Gemini API key

Cloud Billing `projects.getBillingInfo` requires an OAuth access token with Cloud Platform / Cloud Billing scopes and project permission (`resourcemanager.projects.get`).

Source: https://docs.cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo

API Keys `keys.lookupKey`, which maps an API key string to its parent project, requires OAuth plus `apikeys.keys.lookup` permission; the Gemini key itself is not sufficient authorization to perform that lookup.

Source: https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/keys/lookupKey

Google's API key guidance also states that standard API keys associate a request with a project for billing/quota but do not authenticate a principal.

Source: https://docs.cloud.google.com/docs/authentication/api-keys

Security consequence: the phone must not infer project/billing state from local state, and must not receive a long-lived privileged Cloud Billing/API Keys credential merely to make the inference key executable.

### 4. Gemini inference responses do not provide billing-tier authority

The documented `GenerateContentResponse` exposes candidates, prompt feedback, token usage metadata, model version, response ID, and model status. It does not expose a cryptographic/provider billing-tier attestation that could authorize the request before it is sent.

Source: https://ai.google.dev/api/generate-content

Security consequence: post-response token usage metadata cannot prove pre-call non-billable authority, and using a provider call to discover billing state would itself violate fail-closed preauthorization.

### 5. Project spend caps are not hard zero-spend enforcement

Gemini's Billing documentation marks project spend caps as experimental and explicitly warns of approximately 10 minutes of latency and possible overages; long-running tasks can exceed the project cap. Paid-tier billing-account caps are non-zero (Tier 1 begins at a non-zero monthly cap).

Source: https://ai.google.dev/gemini-api/docs/billing

Security consequence: project spend cap, prepay balance, auto-charge limit, paid-tier cap, or billing estimate is **BLOCKED** as zero-cost authority.

### 6. Generic Cloud budgets are alerts, not enforcement

Google Cloud Billing documentation explicitly states that setting a budget does not automatically cap usage or spending and does not automatically prevent use or billing when thresholds are exceeded.

Source: https://docs.cloud.google.com/billing/docs/how-to/budgets

Security consequence: budget amount, alert, email, Pub/Sub notification, or dashboard state is **BLOCKED** as execution authority.

### 7. API quota/rate limits are not exact billing caps

Google Cloud API usage documentation states quota limits are API-specific volume controls, not project-wide spend caps, and are not always entirely precise because enforcement has latency.

Source: https://docs.cloud.google.com/apis/docs/capping-api-usage

Gemini rate limits vary by project usage tier; paid tiers also have non-zero spend-rate limits. Free-tier rate limits describe capacity, not a key-level immutable billing guarantee.

Source: https://ai.google.dev/gemini-api/docs/rate-limits

Security consequence: RPM/TPM/RPD/free-tier quota values are **BLOCKED** as zero-spend authority unless independently bound to an authoritative unlinked-billing project state.

### 8. Trial/promotional credit is not zero-spend authority

Gemini Billing documentation states that, starting March 2026, Gemini API usage costs are excluded from the Google Cloud $300 Free Trial. Eligible Cloud credits under Prepay also require paid/prepaid billing setup first.

Source: https://ai.google.dev/gemini-api/docs/billing

Security consequence: trial credit, promo credit, prepaid balance, or `No credits` UI state is **BLOCKED** as a TigerIQ 0đ authority.

## Hard enforcement vs non-authority matrix

| Signal/configuration | Provider-side? | Hard zero-spend? | Android execution authority now? | Decision |
| --- | --- | --- | --- | --- |
| Project unlinked from Cloud Billing; authoritative `billingEnabled=false`, no billing account | Yes | **Yes at project billing layer**: paid services unavailable; Gemini project returns to Free tier | **No**, current Android cannot independently verify exact key→project + live billing state without privileged OAuth and has TOCTOU risk | Candidate authority source only |
| Gemini Free Tier eligibility / model free price | Yes | No, because the same key inherits project billing status and paid project pricing can differ | No | BLOCKED |
| API key restriction to Gemini API | Yes | No; restricts API surface, not billing tier | No | BLOCKED |
| AI Studio `Free` / `Set up billing` UI label or screenshot | Provider UI | No cryptographic/runtime guarantee | No | BLOCKED |
| Project spend cap | Yes | No; documented latency/overages | No | BLOCKED |
| Billing-account tier spend cap | Yes | No; paid caps are non-zero | No | BLOCKED |
| Cloud Billing budget/alert | Yes | No; alert only | No | BLOCKED |
| RPM/TPM/RPD quota | Yes | No; not exact spend enforcement | No | BLOCKED |
| Spend-rate limit | Yes | No; paid tiers allow non-zero spend | No | BLOCKED |
| Prepay balance / $0 balance | Yes | No; already paid model and not auto-downgraded to Free | No | BLOCKED |
| Trial/promotional credit | Yes | No | No | BLOCKED |
| Local/user `free_confirmed`, SharedPreferences, imported state | No | No | No | BLOCKED |

## Threat model

### T1 — Local privilege escalation
Attacker/user edits local state or UI and sets `free_confirmed`/`free`/`0đ`.

Control: local state is never authority. Existing Issue #150 fail-closed policy remains.

### T2 — Paid-key substitution
A different Gemini key from a paid project replaces the intended free-project key.

Control required: authority must bind to a SHA-256 fingerprint of the exact provider key and to the authoritative parent project obtained from Google API Keys lookup. Never include the raw key in evidence.

### T3 — Billing relink after verification (TOCTOU)
Project is verified as unlinked, then linked to an active billing account before a later Gemini call.

Control required: cached or long-lived attestation is insufficient. Any future design must have provider-side governance that prevents billing association for the authorization window, or a provider-issued request-time free-only mechanism. Current official Gemini documentation does not expose such a request-time free-only mechanism.

### T4 — Stale/replayed attestation
Old valid free-state evidence is replayed after billing changes.

Control required: short expiry, nonce/job binding, monotonic issued-at, anti-replay storage, and fail-closed on freshness failure. This still does not by itself solve T3.

### T5 — Fake UI/screenshot/evidence
A screenshot or locally copied `Free` label is presented as authority.

Control: only machine-verifiable provider-derived data may be accepted.

### T6 — Privileged verifier credential leakage
Placing OAuth/service-account billing lookup credentials on Android creates a new high-value secret.

Control: do not place a long-lived Cloud Billing/API Keys privileged credential on the phone. If a verifier is ever introduced, it must keep its privileged credential off Android and return only a signed, non-secret attestation.

### T7 — Verification unavailable
Google Billing/API Keys lookup fails, times out, or returns ambiguous state.

Control: `unknown/disabled`; zero provider calls; no paid fallback.

## Proposed verification contract — research design only, NOT executable authorization yet

A future independent verifier could emit a signed object such as:

```json
{
  "version": 1,
  "provider": "gemini",
  "keyFingerprintSha256": "<sha256 only>",
  "projectId": "<google-project-id>",
  "keyProjectBindingVerified": true,
  "billingEnabled": false,
  "billingAccountName": "",
  "billingSource": "cloudbilling.googleapis.com/v1/projects/{projectId}/billingInfo",
  "keySource": "apikeys.googleapis.com/v2/keys:lookupKey",
  "checkedAtMs": 0,
  "expiresAtMs": 0,
  "nonce": "<one-time>",
  "policy": "TIGERIQ_ZERO_SPEND_V1"
}
```

Android could verify the attestation signature with a pinned public key, compare the locally held Gemini key's SHA-256 fingerprint, enforce freshness/non-replay, and never receive the verifier's Google OAuth credential.

**But this contract is intentionally not accepted as executable today.** It proves point-in-time state only. To become `allowed`, TigerIQ still needs documented/enforceable protection against T3 (billing relink during the authorization window) or a future Google request-time/free-only provider primitive. Without that final enforcement property, the state remains `unknown/disabled`.

## Allowed / blocked state machine

Current production-independent research policy:

- `UNKNOWN` -> **BLOCKED**
- `LOCAL_FREE_CLAIM` -> **BLOCKED**
- `FREE_TIER_UI_ONLY` -> **BLOCKED**
- `QUOTA_OR_BUDGET_ONLY` -> **BLOCKED**
- `PAID_PROJECT` -> **BLOCKED**
- `PREPAY_OR_CREDIT` -> **BLOCKED**
- `UNLINKED_BILLING_POINT_IN_TIME_ATTESTED` -> **BLOCKED pending TOCTOU closure**
- `PROVIDER_ENFORCED_FREE_ONLY_EXACT_KEY_REQUEST` -> **ALLOWED only if such a primitive is officially documented and machine-verifiable in the future**

At research date 2026-09-02, no official Google/Gemini source found documents the final `PROVIDER_ENFORCED_FREE_ONLY_EXACT_KEY_REQUEST` primitive.

## PR #140 action

No runtime policy reduction is authorized by this research.

Keep:
- Controller V1;
- Android Keystore device identity/proof;
- provider credential only on phone;
- RESULT/evidence;
- dedupe/idempotency/recovery;
- `ZeroCostAuthority` = unverified/disabled;
- `ZeroCostPolicy` fail-closed before key read/provider network;
- no paid fallback.

Do not:
- create or rotate a Gemini key;
- link a billing account or payment method;
- purchase Prepay credits;
- invoke Gemini to test billing;
- use screenshots/local state as proof;
- weaken Issue #150 regression;
- mutate MAIN/Production.

## Final marker

`GEMINI_ZERO_SPEND_AUTHORITY_RESEARCH_READY`
