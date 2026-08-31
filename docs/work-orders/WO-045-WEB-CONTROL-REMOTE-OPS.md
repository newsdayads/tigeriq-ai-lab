# WO-045 — Web Control Remote Operations

## Goal
Turn the primary TigerIQ Web Control into the Owner's single remote operations surface for verified status, work/evidence visibility, safe Work Order dispatch, and bounded PC01 channel checks without asking the Owner to open PowerShell or paste browser credentials.

## Audited baseline — 2026-08-31
- Source branch starts from MAIN `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042).
- Production Vercel is still on older MAIN SHA `69ef75149155c09d4618afef941e54cf02feaf79`; WO-041/042 are not production-released.
- PC01 runtime is explicitly deferred by Owner instruction while physical access is unavailable. Missing PC01 CLAIM/RESULT evidence is recorded but is not a blocker for Web-only hardening.
- PC01 recovery/security remain owned by their PC01 streams; WO-045 does not modify that runtime.
- `docs/CURRENT_STATE.md` reconciliation is owned by independent audit #113 and is intentionally not edited here to avoid scope collision.
- Vercel Hobby automatic deployment quota may report `api-deployments-free-per-day`; that provider-capacity status is not treated as a code-quality PASS or FAIL.

## Scope
- Primary `/` Web Control UX.
- Read-only Web status aggregation needed by the UI.
- Owner-authenticated Work Order dispatch through the existing `/api/control` contract.
- Canonical bounded PC01 status canary without creating duplicate canary Issues.
- Lifecycle/evidence visibility: CLAIM, RESULT/FAILED, REVIEW_PASS, JUDGE_PASS.
- Completion truth gate: Issue closure alone is never DONE; RESULT evidence, REVIEW_PASS and JUDGE_PASS must be present in order.
- Explicit distinction between PC01 execution-channel evidence and unknown physical-device state.
- Non-Vercel contract/regression tests executing real Web Control handlers against simulated transports.

## Non-scope
- No App changes.
- No AI coordinator/model-routing changes.
- No PC01 worker/watchdog/controller runtime changes.
- No Work Management engine changes.
- No independent-review/governance changes.
- No MAIN or Production release in this work order.
- No direct browser-to-shell, arbitrary command execution, credential entry, or secret exposure.

## Security remediation
Independent Web review found two P0 defects on prior head `0988c2ce...`:
1. OAuth callback could overwrite the Owner session cookie while clearing the OAuth state cookie.
2. `/api/control` still accepted a browser-supplied GitHub PAT as a write authorization bypass.

Remediation now on this branch:
- Owner OAuth appends both session cookie and state-clear cookie instead of replacing `Set-Cookie`.
- Browser GitHub PAT is not a write credential. Browser-origin mutation requires Owner session + server-side GitHub credential. Internal server-secret path is restricted to non-browser requests.
- Work Order creation is fingerprint-deduplicated and serialized for same-fingerprint in-flight requests within the process.
- Canary operation reuses canonical `TIGERIQ_PC01_CANARY_ISSUE` and creates no duplicate canary Issue.
- Lifecycle classifier requires ordered RESULT with concrete evidence -> REVIEW_PASS -> JUDGE_PASS before `completed`; closed-but-unverified remains pending/unverified.
- Executable OAuth regression verifies callback returns both cookies and the resulting session authenticates the next request.

## Exact-head engineering evidence
Exact tested head before this documentation-only update: `63029e127b44f32b972abe8e9af76b77618d2c31`.
- CI run `33363588923` / #242: PASS — PowerShell syntax, install, typecheck, Vitest, Playwright smoke, build.
- Queue Hygiene run `33363589104` / #169: PASS.
- Vercel invariant run `33363588941` / #143: PASS.
- Regression coverage includes OAuth multi-cookie/session authorization, browser-PAT rejection, Owner-authenticated server-side write, Work Order dedupe, canonical canary reuse, and evidence/review/judge completion ordering.

This documentation commit changes no Web runtime behavior; a final exact-head CI/regate is still required before independent PASS.

## Acceptance checklist
- [x] `/` is one unified Web Control page for monitoring and remote operations.
- [x] Unauthenticated/unconfigured Owner state is read-only and fail-closed.
- [x] Browser never asks for GitHub token or command secret.
- [x] Browser-supplied GitHub token cannot authorize mutation.
- [x] OAuth callback preserves Owner session while clearing OAuth state.
- [x] Work Order creation is deduplicated for normal repeated/double-submit paths.
- [x] PC01 canary action reuses canonical canary and does not create duplicate Issues.
- [x] Closed Issues cannot be projected as completed without RESULT evidence + ordered REVIEW_PASS + JUDGE_PASS.
- [x] PC01 UI does not claim physical online/offline without direct evidence.
- [x] Static and executable security regression tests pass.
- [x] Full repository typecheck/tests/Playwright/build passed on security-fix head.
- [ ] Final exact-head gates after evidence/docs update.
- [ ] Owner OAuth runtime smoke with real configured Google provider/environment.
- [ ] Independent Web Control review/gate PASS on final exact head.
- [x] PC01 runtime gate deferred; integration path remains prepared for later end-to-end verification.
- [x] Production remains unchanged until explicit release authorization.

## Release gate
For the current Web-only hardening pass, PC01 availability is not a stop condition. Web Control can become a release candidate when final exact-head automated gates, real Owner OAuth runtime smoke, and independent Web review PASS. MAIN/Production remain unchanged until explicit Owner release authorization. PC01 end-to-end consumption is a later integration gate before autonomous PC execution is trusted, not a blocker for completing Web-only hardening.
