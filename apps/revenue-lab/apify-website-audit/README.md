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

## R10 commercial evidence and pricing-change gate (source-only, not release)

Run `npm test` to include the deterministic R10 economics regression alongside the existing website-audit tests. Every R10 scenario is **hypothetical**. The private Apify Actor's **settled** cost per run and paying-user demand remain **unverified**; the Owner Console's displayed USD 0.000 is rounded and not a final invoice. Do not claim `KEEP`, a public price, revenue or successful paid release from these calculations. A zero-priced event has no positive developer proceeds, so the 30%-margin CU capacity is **null**, not zero.

For future paid publication or price changes, verify the current [official Apify monetization setup policy](https://docs.apify.com/actors/monetize/set-up-monetization) in the authorized Actor Console. Apify defines switching pricing models, increasing prices and adding paid events as **significant**. The documentation describes a **14-day notice** when the Actor has paying users, with existing prices continuing meanwhile; the waiting period does **not** apply to an Actor with **no paying users**. Pending significant changes cannot be canceled or changed directly; significant changes are generally limited to once per month per Actor. Whether TigerIQ has paying users or a pending pricing change is **not verified**. Never infer live pricing readiness or permission to publish from this README.

A new market comparator observed on 2026-10-16, [AI Visibility Site Audit](https://apify.com/43sunsets/ai-visibility-site-audit), advertises **from USD 250 / 1,000 generated reports** as a Store headline (not authenticated checkout). Its current listing describes **21 crawler user-agent/control tokens** and `maxPages` **up to 2,000**; this can change without notification. TigerIQ's current actor only supports up to 10 same-origin pages and makes **no** claim to provide full AI crawler visibility or Lighthouse scores. Market listings and policy facts are decision inputs, not accepted R04/R05 runtime/usage evidence or a commercial launch approval.

## R09 — Accurate HTML meta description evidence (2026-10-16)

The original regex could falsely label `<meta data-name="description" ...>` as the document's description, and failed on valid HTML unquoted forms such as `<meta name=description content=Unquoted>`. Source-only fix parses exact attribute names for meta tags, allows quoted or unquoted values in either order, and ignores `data-name` decoys. Node HTTP local fixtures cover both positive and negative cases. URL/DNS/SSRF gates, crawler routing, traffic budget and paid Apify behavior are unchanged. This is not a production/Apify Actor run, invoice, or R09 commercial acceptance.
