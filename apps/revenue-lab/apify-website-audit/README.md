# Apify Website Audit (Revenue Lab PoC)

Standalone zero-cost-first website audit Actor, isolated from TigerIQ Core and App Chrome.

## Current build scope

- Real bounded HTTP/HTTPS fetches; no fabricated Lighthouse, ranking, or performance scores.
- Same-origin crawling with `maxPages` capped at 10.
- DNS resolution and pinned connections reject private, loopback, link-local, CGNAT, multicast, and reserved targets.
- Redirects are manually bounded and every redirect target is revalidated.
- Response size, request timeout, and inter-request delay are bounded.
- Stable JSON schema with explicit error codes.
- Actionable SEO findings per audited page (missing title, missing meta description, missing or multiple H1) with severity, remediation and aggregate totals. These are observed HTML findings, not Google ranking, Lighthouse or performance scores.
- No paid external API calls.

## Input

- `url` — required target URL.
- `maxPages` — 1..10, default 1.
- `timeoutMs` — 250..30000 ms, default 8000.
- `maxBytes` — 1 KB..5 MB per response, default 1 MB.
- `maxRedirects` — 0..5, default 3.
- `requestDelayMs` — 0..2000 ms between pages.

## Verifiable real localhost UI end-to-end evidence

The required GitHub `Revenue Actor Entry Contract` job now runs a public
HTML audit through **two independent real HTTPS paths**:

1. The existing bounded direct HTTP audit, logged as
   `TIGERIQ_REVENUE_PUBLIC_LIVE_EVIDENCE`.
2. A real local `127.0.0.1` server started in the CI runner, called with
   `POST /api/audit` for the actual `https://example.com/` URL (no
   injected mock audit). Its returned Markdown report and SHA-256 digest
   are logged as `TIGERIQ_REVENUE_PUBLIC_UI_REAL_E2E`.

The UI evidence proves a **real HTTP POST → real public HTTPS fetch → SEO
analysis → Markdown response** on the GitHub CI runner at the exact source
revision. It is not a browser click test, not access to the Owner's PC01,
not a publicly accessible hosted product, and not an authenticated/private
Apify run or platform invoice. The public HTTP path uses no paid API and
does not prove that Apify compute units cost zero. R04/R05 remain gated.

## Tải báo cáo và khởi chạy tại máy (không cần Apify)

- Windows: trong thư mục này, chạy `run-audit-windows.cmd`.
- macOS/Linux: chạy `sh run-audit-mac-linux.sh`.
- Yêu cầu Node.js 20+; giao diện và bộ phân tích HTML dùng thư viện Node.js có sẵn, không cần tài khoản Apify hay gọi API trả phí. Mở `http://127.0.0.1:4179/` sau khi khởi chạy.
- Sau khi kiểm tra thành công, chọn **Tải báo cáo Markdown** để lưu kết quả ở trình duyệt. Báo cáo cũ bị vô hiệu hóa ngay khi gửi kiểm tra tiếp theo hoặc khi yêu cầu bị lỗi; không lưu báo cáo phía máy chủ.
- Lệnh `npm test` bao gồm kiểm thử nút xuất báo cáo, xóa liên kết xuất cũ và cổng chống yêu cầu chéo nguồn. Việc chạy local không phải nghiệm thu private Apify, chi phí hoặc phát hành Production.

## Browser preview on the owner's own machine

Run `npm run audit:ui` from this app folder, then open
`http://127.0.0.1:4179/` in a browser. Enter a public HTTP/HTTPS URL,
select a 1–3-page bound, and receive a real actionable SEO Markdown
report. When a follow-up page fails, the local API returns `status=partial`
instead of mislabeling it as full success; the browser still shows and
exports findings from successfully checked pages with a clear warning.
The report gives a bounded skipped-page count, never failing URLs or
upstream diagnostics. The backend makes actual HTTP requests through the same bounded
audit engine as the CLI; the HTML only displays the result as plain text.

Security: server always listens on `127.0.0.1` (never `0.0.0.0`),
enforces localhost Host and same-origin JSON POST, limits input bytes,
does not persist submissions, never echoes the input URL in errors,
does not download browser scripts or use third-party APIs. The browser
UI is **local-only**, not a public launch, production deployment,
authenticated Apify Actor run or final platform billing receipt.
There is no connection to TigerIQ Core, PC01 or App Chrome.

## Real public Website Audit report (no Apify account needed)

`node website-report.mjs https://example.com/` creates a complete, bounded
Markdown report on stdout. Use `node website-report.mjs https://example.com/ > audit-report.md`
to save it locally. The command runs the real HTTPS audit engine (one page by
default) and reports observed title/meta/H1 problems, severity, and fixes.
URL query strings and fragments are omitted from page labels so credentials
are not exposed in the report. Errors print fixed codes, not raw upstream URLs.

GitHub Actions' existing Revenue Actor Entry job also audits the public
`https://example.com/` URL through real HTTPS and emits
`TIGERIQ_REVENUE_PUBLIC_LIVE_EVIDENCE` containing
`productReportMarkdown`, `actionableFindings`, and source revision.
This is an actual public-web product example, **not** authenticated/private
Apify verification, a final platform cost, a paid report, or a production release.

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
