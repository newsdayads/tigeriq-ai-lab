# Apify Website Audit (Revenue Lab PoC)

Standalone zero-cost-first website audit Actor, isolated from TigerIQ Core and App Chrome.

## Current build scope

- Real bounded HTTP/HTTPS fetches; no fabricated Lighthouse, ranking, or performance scores.
- Same-origin crawling with `maxPages` capped at 10.
- DNS resolution and pinned connections reject private, loopback, link-local, CGNAT, multicast, and reserved targets.
- Redirects are manually bounded and every redirect target is revalidated.
- Response size, request timeout, and inter-request delay are bounded.
- Stable JSON schema with explicit error codes.
- No paid external API calls.

## Input

- `url` — required target URL.
- `maxPages` — 1..10, default 1.
- `timeoutMs` — 250..30000 ms, default 8000.
- `maxBytes` — 1 KB..5 MB per response, default 1 MB.
- `maxRedirects` — 0..5, default 3.
- `requestDelayMs` — 0..2000 ms between pages.

## Cost evidence

Local/CI audit logic uses no paid external API, so `externalApiCostUSD=0`.
`platformCostUSD` remains `null` with status `pending_private_apify_run` until a private Apify run provides real platform-usage evidence. No estimate is substituted.

## Tests

`npm test` runs safety/error/integration coverage plus a deterministic 20-run benchmark. The benchmark must achieve at least 95% successful completion and prints a `TIGERIQ_BENCHMARK_EVIDENCE` record for CI evidence.

Private Apify deployment, paid publication, KYC/payout, x402, and Production remain outside this work order.

## Private Apify E2E harness

After the Owner creates or links the **private** Actor in Apify and injects credentials outside chat, run:

`APIFY_TOKEN=... APIFY_ACTOR_ID=... APIFY_E2E_EXECUTE=OWNER_APPROVED_PRIVATE_TEST npm run apify:e2e`

Required execution gate: `APIFY_E2E_EXECUTE=OWNER_APPROVED_PRIVATE_TEST`. Optional environment variables: `APIFY_ACTOR_VERSION` (default `0.1`), `APIFY_BUILD_TAG` (default `latest`), and `APIFY_EVIDENCE_PATH` to persist redacted evidence. The production API origin is pinned to `https://api.apify.com/v2` and cannot be overridden from the environment.

The harness builds the existing private Actor, runs one bounded `https://example.com` audit with `LIMITED_PERMISSIONS`, waits for terminal success, then waits 10 seconds and refetches the exact build/run before recording authenticated `usageTotalUsd` plus compute units. This avoids preliminary eventually-consistent usage values. It then reads the `OUTPUT` record and fails closed if finalized cost evidence is absent.

Secrets are sent only in the `Authorization: Bearer` header and are never placed in URLs or evidence. Actor creation/update, public publication, paid enablement, KYC/payout, and Production remain outside scope.

## Private Apify preflight

After the Owner creates or links the **private** Actor and injects credentials outside chat, run the read-only preflight first:

`APIFY_TOKEN=... APIFY_ACTOR_ID=... APIFY_PREFLIGHT_EXECUTE=OWNER_APPROVED_PRIVATE_PREFLIGHT npm run apify:preflight`

The preflight performs only authenticated `GET https://api.apify.com/v2/users/me` and `GET https://api.apify.com/v2/actors/:actorId`. The API origin is fixed and cannot be overridden from the environment. If a resource-scoped token returns `403` for `/users/me`, the account-profile check is recorded as `SKIPPED_SCOPED_FORBIDDEN` and Actor access remains the authoritative read-access proof; this avoids requiring broader account permissions.

It fails closed unless the Actor is private (`isPublic=false`), requests `LIMITED_PERMISSIONS`, and contains the expected Actor version (default `0.1`). Evidence contains only account ID/username plus minimal Actor identity and never includes email, profile data, or tokens.

Read access does **not** prove Build/Run permission or permission to read the run's default storage. Preflight evidence records Build, Run, and default-output-storage read as `UNVERIFIED_UNTIL_E2E`. For the scoped token used by the private E2E, enable access to default run storages so the harness can read the `OUTPUT` record; the E2E then proves those permissions and measured platform cost.
