# TigerIQ Vercel Web-Hosting-Only Policy

Status: **AUTHORITATIVE / HARD BOUNDARY** — enforced by source guard + CI.

## Role

Vercel has exactly one TigerIQ role: **host and publish the owner-facing web/LIVE surface**.

Vercel is **not** TigerIQ Core, scheduler, router, queue, lease authority, NV API executor, PC01 runtime, Source of Truth, or a general-purpose verification surface.

A Vercel-hosted endpoint such as `/api/live-status` may transport/present data whose authority is PC01 runtime. Hosting that endpoint does not move execution or data authority to Vercel.

## Hard deployment rules

- `vercel.json -> git.deploymentEnabled` MUST remain `false`.
- Normal commits and pull requests MUST NOT create Vercel Preview or Production deployments.
- Core, NV API, Android, PC01, docs, governance, tests, queue audits, status checks, reviews, and non-web work MUST NOT invoke Vercel deployment.
- Vercel deployment is permitted only when a **real owner-facing web/LIVE artifact changed and must be published**.
- Every allowed Production deployment must be explicit, one-shot, exact-SHA, authorized, and use the single canonical web-release script. Authorization is either a one-shot Owner release or the canonical P1–P5 standing release authorization from `#4425 - [P0][CONTROL] P1–P5 outcome-to-LIVE tự hoàn tất + WAIT theo bước`. P0 never inherits that standing authorization.
- A deployment MUST NOT be created merely to “verify Vercel”, inspect Core/NV API health, refresh LIVE data, or prove a non-web task.
- Vercel-specific checks may validate configuration/routing without creating a deployment.

## Canonical release gate

The only allowed deployment command is inside:

`scripts/pc-worker/vercel-tigeriq-live-3150-deploy.mjs`

That script must fail closed unless all are true:

1. release class is exactly `WEB_LIVE`;
2. release authorization is explicitly present in the typed request; for P1–P5 this may be materialized from the standing authorization, while P0 still requires direct Owner/Vy control;
3. release reason is non-empty;
4. an explicit numeric GitHub issue is supplied;
5. exact main SHA matches;
6. a verified web-artifact commit is supplied, is an ancestor of the exact main SHA being deployed, and that artifact commit contains a web-hosting change (`command-center.html`, `public/**`, `api/**`, or `vercel.json`);
7. Git auto-deploy remains disabled.

## CI enforcement

`scripts/verify-vercel-deployment-policy.mjs` must fail when:

- Git auto-deploy is re-enabled;
- a GitHub workflow contains a Vercel deploy command;
- any second script introduces a Vercel deploy command;
- the canonical deploy script loses its hard release gates.

The web-hosting-specific workflow is path-scoped to web-hosting files only and performs **verification only**. It must not deploy.

## Operational rule

For Core/NV API/queue/runtime audits, read PC01 runtime/LIVE data and GitHub canonical state. Do **not** inspect or create Vercel deployments unless the task itself is a web/LIVE release or web-hosting incident.

Owner web-hosting boundary: 2026-10-04, issue #3897. P1–P5 standing release extension: 2026-10-07, `#4425 - [P0][CONTROL] P1–P5 outcome-to-LIVE tự hoàn tất + WAIT theo bước`.
