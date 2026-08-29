# TigerIQ AI Lab — Revenue Opportunity Research

Date: 2026-08-29
Status: Research checkpoint, no financial commitment

## Current external evidence
- Vietnam ride-hailing is estimated at about USD 1.25B in 2026 with high-teens annual growth; vans/MPVs and EV fleets are among faster-growing segments. Source: Mordor Intelligence, updated 2026-08-04.
- Green SM held roughly 54.5% of Vietnam technology-taxi share in Q1/2026 according to reporting citing Mordor Intelligence; Grab was about 40.9% and be about 4.6%. Source: VietnamNet, 2026.
- HCMC is actively promoting AI/automation adoption for SMEs through the 2026-2030 SME digital-transformation program. Source: HCMC Department of Science and Technology, 2026-07-01.
- Recent Vietnamese SME research describes broad AI experimentation but low autonomy; trust and demonstrated value are key constraints on deeper adoption. Sources: Tạp chí Xây dựng 2026-07-09; Tạp chí Công Thương 2026-08-04.

## Ranked opportunities

### 1. TigerIQ Driver → Driver/Fleet Settlement & Operations SaaS
Score: 9/10

Why now:
- Existing working product, real operating workflow and domain knowledge already exist.
- The system already handles multi-app rides, image evidence, net revenue, settlements and driver sharing logic.
- Ride-hailing/fleet activity is growing; fleet operators increasingly need standardized data, reconciliation and accountability.

MVP customer:
- Small owner-operated fleets with 2-20 vehicles/drivers using multiple ride-hailing apps.

Paid problem:
- Daily revenue reconciliation, cash/card split, driver-owner settlement, missing-trip detection, evidence retention and shift closing.

Monetization hypothesis:
- Free single-driver tier.
- Paid fleet tier per active vehicle/driver per month.
- Optional setup/migration service.

Validation target before spending:
- 5 external fleet/driver interviews.
- 2 real operators willing to test with their own daily settlement data.
- At least 1 explicit willingness-to-pay signal.

### 2. Productized SME AI Automation Service
Score: 8/10

Why now:
- HCMC/SME policy environment is actively pushing AI and automation.
- Research suggests adoption is wide but autonomy/value proof is weak, creating demand for concrete end-to-end workflows rather than generic AI advice.

Offer:
- Fixed-scope automation packages: inbox/CRM follow-up, quotation/PO workflows, reporting, document extraction, approval tracking and operations dashboards.

Differentiation:
- Evidence-gated execution and measurable before/after operating metrics from TigerIQ Company OS.

Risk:
- Service business can become custom consulting. Require reusable templates and fixed scope.

Validation target:
- 10 SME problem interviews; sell one paid pilot before building generalized platform features.

### 3. TigerIQ Company OS / Control Center as AI Operations Platform
Score: 6.5/10 near-term, 9/10 strategic

Why:
- Strong platform differentiation if orchestration, evidence, gates and multi-model routing become reliable.
- Potential internal dogfood across TigerIQ Driver and future products.

Constraint:
- Longer time-to-revenue and crowded AI-agent platform market. Do not prioritize external commercialization before internal operating proof and at least one vertical use case produces revenue.

### 4. TigerIQ DeX Shot / Mobile Capture Utility
Score: 5.5/10 direct revenue, 8/10 acquisition utility

Role:
- Keep as a free/low-cost utility or companion feature that solves high-frequency screenshot capture and can funnel users into TigerIQ Driver/automation products.
- Do not invest in standalone paid acquisition until retention/use data justifies it.

## Decision
Primary commercial validation track: **TigerIQ Driver Fleet Settlement SaaS**.
Secondary track: **productized SME automation pilots**.
Company OS remains enabling infrastructure until vertical proof exists.

## Capital discipline
- No paid ads, subscriptions, cloud expansion, hiring or hardware activation before customer validation.
- Prefer existing GitHub/Vercel/free-tier infrastructure and current assets.
- A revenue experiment must define customer, pain, offer, price hypothesis, success metric and stop condition.

## Next work order proposed
WO-006 — Driver Fleet SaaS Customer Discovery & Offer: define ICP, interview script, value proposition, pricing hypotheses and a 2-customer pilot plan without changing Production.
