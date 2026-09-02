# P0 — Vercel Web-only Boundary Cleanup

Status: REVIEW CANDIDATE ONLY · PR #159 · NO MAIN / NO PRODUCTION

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
Repository/runtime call-graph audit found no Owner Cockpit V3 frontend consumer for the following functions. Legacy tests/docs are historical evidence, not runtime consumers. They are removed from `api/`, so Vercel cannot deploy them as Production/Preview functions:

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

After cleanup:
- `api/` contains only `owner-auth.mjs`;
- no active V3 Web or Vercel serverless source references Vercel AI Gateway, OpenAI API, Gemini API, AI Gateway credentials, `getVercelOidcToken`, or `decideWithChief`;
- AI/model/runtime authority stays outside Vercel.

## Deployment trigger matrix

### Before
| Change/event | Vercel behavior |
|---|---|
| ordinary Git commit on connected branch | automatic deployment attempt |
| PR synchronize | automatic Preview attempt |
| PC01-only changes | deployment attempt possible/observed |
| Android-only changes | deployment attempt possible |
| docs-only changes | deployment attempt possible |
| Web Release Candidate | automatic Preview attempt mixed with ordinary commits |
| Production branch update | could create Production deployment through Git integration |

### After
`vercel.json` sets `git.deploymentEnabled=false`.

| Change/event | Vercel behavior |
|---|---|
| ordinary Git commit | NO deployment |
| PR synchronize | NO automatic Preview |
| PC01-only changes | NO deployment |
| Android-only changes | NO deployment |
| docs-only / non-Web changes | NO deployment |
| approved Web Release Candidate | manual `WEB Release Vercel` workflow only; exact `release_sha` + `WEB_RELEASE_CANDIDATE_APPROVED` |
| Production | manual workflow only; exact `release_sha` + `OWNER_APPROVED_PRODUCTION` + non-empty `owner_approval_ref`; Production environment gate remains separate |

The release workflow has only `workflow_dispatch`; it has no `push` or `pull_request` deployment trigger. Validation reruns the Web boundary, Typecheck, Unit, desktop+iPhone Playwright and Build before any explicit Vercel command.

## Automated enforcement
- `tests/vercel-web-only-boundary.test.ts` — Unit/contract gate.
- `scripts/verify_vercel_web_only_boundary.mjs` — static call-graph + deploy-trigger gate.
- Queue Hygiene executes the boundary verifier.
- Vercel Verify no longer tests Chief/AI functions; it verifies Owner auth + Web-only boundary + normal repo gates.

No VPS, Cloudflare, paid service, PC01 runtime, Android runtime or PostgreSQL runtime change is part of this cleanup.
