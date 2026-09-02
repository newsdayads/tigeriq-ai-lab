# P0 — Vercel Web-only Boundary Cleanup

Status: `VERCEL_WEB_ONLY_BOUNDARY_READY_FOR_REVIEW` · PR #159 · NO MAIN / NO PRODUCTION

Exact review head: `ec6d9150bc2c5facaff467fb302bfcd048eaa6a6`.
Baseline before boundary cleanup: `4c03113762e987597cc4b71bdd877fbfafc82347`.

## Boundary decision
Vercel is Cloud Web only for TigerIQ Owner Cockpit V3:
- static Web/PWA assets under `public/`;
- serverless `/api/owner-auth` for Owner Google identity/session only.

Vercel is not an AI authority, runtime controller, work database, business database, job dispatcher, model router or PC01 proxy. Browser→PC01 remains direct through the configured Tailscale Controller base URL.

## V3 runtime call graph evidence

| Caller | Destination | Authority | V3 consumer state |
|---|---|---|---|
| `public/web-v1/app.js` | `/api/owner-auth?action=status` | Vercel Owner session read | ACTIVE |
| `public/web-v1/app.js` | `/api/owner-auth?action=identity` | Vercel Owner identity/session establishment | ACTIVE |
| `public/web-v1/controller-client.js` | `${baseUrl}/api/workforce/status` | PC01 Controller via Tailscale | ACTIVE, NOT VERCEL |
| `public/web-v1/controller-client.js` | `${baseUrl}/api/web/v1/snapshot` | PC01 authoritative snapshot | ACTIVE, NOT VERCEL |
| `public/web-v1/controller-client.js` | `${baseUrl}/api/web/v1/goals` | Owner intent to PC01 Controller | ACTIVE, NOT VERCEL |
| `public/web-v1/controller-client.js` | `${baseUrl}/api/web/v1/prompts/versions` | PC01 Controller | ACTIVE, NOT VERCEL |
| `public/web-v1/controller-client.js` | `${baseUrl}/api/web/v1/jobs/:id/retry` | PC01 Controller retry intent | ACTIVE, NOT VERCEL |

`controllerUrlPolicy()` constrains the Controller host to Tailscale/local forms and the snapshot validator requires `source.mode=controller` plus `authoritative=true`. There is no same-origin fallback to Vercel for Controller data.

## Retired Vercel serverless execution paths
Repository/runtime call-graph audit found no Owner Cockpit V3 frontend consumer for the following functions. Legacy tests/docs are historical evidence, not runtime consumers. They are removed from `api/`, so a deployment built from this review branch cannot expose them as Vercel functions:

| Previous function | Consumer proof | Retirement reason |
|---|---|---|
| `api/chief.mjs` | imported by legacy `control.mjs`; no V3 frontend call | contained Vercel AI Gateway + OpenAI/Gemini decision authority |
| `api/chief-smoke.mjs` | legacy smoke only; no V3 frontend call | AI smoke endpoint must not exist in Cloud Web execution path |
| `api/control.mjs` | no V3 frontend call; V3 uses PC01 Controller client directly | legacy GitHub control + AI `chat` authority not part of V3 Web boundary |
| `api/company-progress.mjs` | no V3 frontend call | obsolete Vercel-side progress projection; V3 Business State comes from Controller/preview adapter truth rules |
| `api/workforce-status.mjs` | no V3 same-origin call | similarly named V3 route is `${baseUrl}/api/workforce/status` on PC01, not Vercel |

Git history preserves the retired source. No source is copied into another deployable serverless directory.

## AI authority removal
Before cleanup, `chief.mjs` used `https://ai-gateway.vercel.sh/v1/chat/completions`, defaulted to an OpenAI model, configured Gemini fallback, and `control.mjs` delegated operation `chat` to `decideWithChief()`.

After this PR is the deployed source:
- `api/` contains only `owner-auth.mjs`;
- no active V3 Web or Vercel serverless source references Vercel AI Gateway, OpenAI API, Gemini API, AI Gateway credentials, `getVercelOidcToken`, or `decideWithChief`;
- AI/model/runtime authority stays outside Vercel.

## Deployment trigger matrix

### Before policy adoption
| Change/event | Vercel behavior |
|---|---|
| ordinary Git commit on connected branch | automatic deployment attempt |
| PR synchronize | automatic Preview attempt |
| PC01-only changes | deployment attempt possible/observed |
| Android-only changes | deployment attempt possible |
| docs-only changes | deployment attempt possible |
| Web Release Candidate | automatic Preview attempt mixed with ordinary commits |
| Production branch update | could create Production deployment through Git integration |

### After this policy is adopted by the deployed branch lineage
`vercel.json` sets `git.deploymentEnabled=false`.

| Change/event | Vercel behavior |
|---|---|
| ordinary Git commit | NO deployment |
| PR synchronize | NO automatic Preview |
| PC01-only changes | NO deployment once branch includes the boundary config |
| Android-only changes | NO deployment once branch includes the boundary config |
| docs-only / non-Web changes | NO deployment once branch includes the boundary config |
| approved Web Release Candidate | manual `WEB Release Vercel` workflow only; exact `release_base_sha` + `release_sha` + Web-only ancestor diff + `WEB_RELEASE_CANDIDATE_APPROVED` |
| Production | manual workflow only; exact SHA/Web-only diff + `OWNER_APPROVED_PRODUCTION` + non-empty `owner_approval_ref`; Production environment gate remains separate |

The release workflow has only `workflow_dispatch`; it has no `push` or `pull_request` deployment trigger. It rejects non-Web paths and rejects docs/tests/workflow-only diffs as release candidates. Validation reruns the Web boundary, Typecheck, Unit, desktop+iPhone Playwright and Build before any explicit Vercel command.

## Current activation truth
This P0 is intentionally off MAIN/Production. Therefore repository branches that were created before this policy and have not adopted the new `vercel.json` can still trigger the existing Vercel Git integration. During review, fresh PC01 branch commits were observed creating Vercel deployment attempts, while exact P0 heads did not create deployments.

Global suppression for all long-lived pre-policy branches becomes enforceable only after an Owner-approved adoption path (merge/rebase/project-level Git provider setting). No such MAIN/project Production mutation is performed by CHAT01 under this task.

For final exact head `ec6d9150bc2c5facaff467fb302bfcd048eaa6a6`, the Vercel deployment ledger returned zero deployments after the commit timestamp.

## Exact-head gates
- CI run `33652680967`, job `100323367907`: PASS.
  - Typecheck PASS.
  - Unit: 25 files / 107 tests PASS.
  - `tests/vercel-web-only-boundary.test.ts`: 4/4 PASS.
  - Chromium Playwright: 3/3 PASS — foundation + iPhone V3 + desktop V3.
  - Build PASS.
- Queue Hygiene run `33652681016`, job `100323368124`: PASS, including `VERCEL_WEB_ONLY_BOUNDARY_PASS` and Work Board UI/build gates.
- Vercel Web Boundary Verify run `33652680965`: PASS — Owner auth syntax, boundary/release policy, `vercel.json`, Typecheck/Unit/Build.

## Automated enforcement
- `tests/vercel-web-only-boundary.test.ts` — Unit/contract gate.
- `scripts/verify_vercel_web_only_boundary.mjs` — static call-graph + deploy-trigger gate.
- Queue Hygiene executes the boundary verifier.
- Vercel Verify no longer tests Chief/AI functions; it verifies Owner auth + Web-only boundary + normal repo gates.

No VPS, Cloudflare, paid service, PC01 runtime, Android runtime or PostgreSQL runtime change is part of this cleanup.
