# NV02 — GH-2293: kiểm chứng chất lượng cục bộ & đối chiếu thương mại R09/R10

Date: 2026-10-16 (Asia/Ho_Chi_Minh)  
Canonical Work Order: https://github.com/newsdayads/tigeriq-ai-lab/issues/2293  
Scope: `TIGERIQ_REVENUE_LAB_APIFY_POC_V2`; report/evidence only; no runtime/security/credential changes.  
Status: **ITERATE / HOLD PUBLIC MONETIZATION**; **PRELIMINARY**; `DONE=false`, checklist **3/12**. This file is not a private Apify run receipt, settled bill, or checklist acceptance.

## 1. Verified technical artifacts (from prior durable checkpoint)

- Source correction PR #4907: https://github.com/newsdayads/tigeriq-ai-lab/pull/4907, merged `bfedeaa481e5af26aaa775fb1b403d513bc0407e`.
- Exact current-source file blobs at the evidence run: `audit-engine.mjs` = `b1e2481c6bee1083ad61047f7494d7b1dc44b1f5`; `audit.test.mjs` = `722a05d6f56bb1f3077419867dcd581f8fa81479`.
- Existing local isolated Node v22.16.0 receipt: `node --test audit.test.mjs` **14/14 pass**, plus local deterministic benchmark **20/20 successful**; no independent GitHub Actions artifact for nested suite. Log SHA256 from previous receipt: `e584234cb8e6b164ed970ec497f9c0fbe32bbd46f8ad321e1fbd6e4a8a5e5a1e`. Reconciled with the record https://github.com/newsdayads/tigeriq-ai-lab/issues/2293#issuecomment-6204545661; **not rerun on unchanged SHA** in this report audit.
- Exact PR #4907 CI gates 3/3 successful: https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38823595053, https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38823595061, https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38823595073.
- Only a controlled local HTTP server was exercised in the previous Node test; it is **not** deployed Actor E2E, a real commercial website crawl, a private API read, or measured Apify platform cost.

## 2. Market price evidence (public list prices, not sales)

| Comparable Apify Actor | Current publicly documented price for a page/URL | Limitations |
|---|---|---|
| [abdou_009/apify-seo-audit](https://apify.com/abdou_009/apify-seo-audit) | USD **0.002 / successful URL**, PLUS standard platform compute usage | Developer list price, 500 URL cap, richer SEO field coverage; price independently rechecked by indexed public Store data in this review |
| [automation-lab/website-health-report](https://apify.com/automation-lab/website-health-report) | USD **0.003 / URL** PLUS USD **0.035 / start** | Six health categories and scoring, up to 200 URLs; both events directly confirmed on public listing |
| [insight.solutions/seo-page-audit](https://apify.com/insight.solutions/seo-page-audit) | USD **0.001 / audited page** FREE/Starter, **0.0006 / audited page** Business PLUS USD **0.002 / site summary** and **0.001 / start** | User tiers, optional broken-link event, sitemap + 23 issue codes; new lower-priced comparator directly confirmed on public listing |
| [rod_analytics/seo-site-audit](https://apify.com/rod_analytics/seo-site-audit) | Earlier reported USD **0.006 / page** + **0.001 / start** | Historical snapshot from earlier GH-2293 note only; **not independently fetched/verified in this follow-up** |
| [tanod/seo-audit](https://apify.com/tanod/seo-audit) | Earlier reported USD **0.020 / audited URL** + start fee | Historical snapshot only; **not independently fetched/verified in this follow-up** |

**Do not call the prior USD 0.002–0.020 band the market floor:** independent lower-tier list prices exist. Store listings can change; they are not checkout receipts, matched-scope features, or evidence that any customer paid. TigerIQ's current source covers at most **10 same-origin pages** and basic title/meta/H1/word count rather than full audit grade, issues and fixes.

## 3. Conditional PPE economics, not TigerIQ realized cost

Official Apify cost model for applicable paid-user PPE use: `developer gross profit = 0.8 * event revenue - platform costs`. The platform compute costs vary by tier; free-tier treatment, Standby, fee-pass-through and billing mode must be examined separately. See https://docs.apify.com/actors/publishing/monetize/pricing-and-costs and https://docs.apify.com/actors/publishing/monetize .

Illustrative one paid event per URL, **no run-start cost**, no added API or storage and no tax: 

| Hypothetical event price (USD) | Strict platform cost bound for positive profit (USD) | Max cost for hypothetical >=30% profit on developer share (USD) |
|---:|---:|---:|
| 0.0006 | <0.00048 | 0.000336 |
| 0.0020 | <0.00160 | 0.001120 |
| 0.0060 | <0.00480 | 0.003360 |
| 0.0200 | <0.01600 | 0.011200 |

The 30% threshold is a **what-if**, not Owner-approved pricing. Start/summary event charges in a competing Store Actor cannot be assumed to apply to TigerIQ, and actual settled `computeUnits` and `usageTotalUsd` for the private Actor are **not known**. No price or ROI can be selected from the table.

## 4. Acceptance gate: preserve the real dependency

- **R01–R03** accepted historical milestones **3/12**; R09 source-level test improvement is real but **R09 overall is NOT accepted** without live production-equivalent quality/cost inputs.
- **R04** cannot be accepted without an authenticated read-only GET of the exact **existing** 08-Oct-2026 Actor/run in the owner's authorized scope and matching identity.
- **R05** cannot be accepted without authoritative **settled** usageTotalUsd / computeUnits or an invoice. Owner Console rounded `USD 0.000` **does not mean** settled zero cost.
- **R06–R08** depend on actual scoped authorization and live receipts; **do not rerun** the private Actor or incur new expense to compensate for missing history.
- **R10** preliminary decision: `ITERATE / HOLD PUBLIC MONETIZATION` until usage economics, demand and outstanding historical IPv4-mapped IPv6 safety issue are addressed under separate authorized gates. No `KEEP`, price launch, publication, KYC, payout, or sales success is claimed.
- **R00** Core NV02 atomic lease / fencing / job acceptance has no verified receipt. This report does not claim or free a lease.

## 5. Provenance and owner result

Prior durable source/results: https://github.com/newsdayads/tigeriq-ai-lab/issues/2293#issuecomment-6204545661 and PR #4907.  
Revised detailed conversation deliverable: `NV02_Apify_Market_Evidence_2026-10-16.md`, SHA256 `59c9f6104db01b9d38fdad1ba978fa3f75947be825b1e1c4921e8ccf4f91500c` (separately delivered conversation file, not tracked by this repo).  
This repository note exists to preserve a shorter, traceable decision record with no external attachments or secrets.

**NEXT_WAKE:** an authorized scoped Apify read-only credential + historical Actor/run identity + settled bill/usage evidence. Otherwise the private API gate remains `EXTERNAL_WAIT` **only for those steps**.

**No Actor/private account API call, paid run, PC01/RDC, App Chrome, Production change or security boundary mutation in this audit.**
