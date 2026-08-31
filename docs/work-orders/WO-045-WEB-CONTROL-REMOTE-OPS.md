# WO-045 — Web Control Remote Operations

## Goal
Turn the primary TigerIQ Web Control into the Owner's single remote operations surface for verified status, safe Work Order dispatch, evidence visibility, and bounded PC01 channel checks without asking the Owner to open PowerShell or paste browser credentials.

## Audited baseline — 2026-08-31
- Source branch is `wo045/web-control-remote-ops`, based on MAIN `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042).
- Production remains on older MAIN SHA `69ef75149155c09d4618afef941e54cf02feaf79`; WO-045 is not released.
- PC01 runtime is explicitly deferred by Owner instruction for this Web-only hardening pass. Missing PC01 runtime evidence is not a Web release-candidate blocker.
- PC01 recovery/security remain owned by their PC01 streams; WO-045 does not modify that runtime.
- Vercel Hobby deployment quota/rate conditions are external capacity constraints and are not treated as code-quality PASS/FAIL. Do not spam deployment retries.

## Scope
- Primary `/` Web Control UX.
- Read-only Web status aggregation needed by the UI.
- Owner-authenticated Work Order dispatch through `/api/control`.
- Canonical PC01 status canary reuse without duplicate canary Issues.
- Lifecycle/evidence visibility: CLAIM, RESULT/FAILED, REVIEW_PASS, JUDGE_PASS.
- Completion truth gate: Issue closure alone is never DONE.
- Trusted review/gate provenance: RESULT evidence must be followed by an independently sourced REVIEW_PASS and then JUDGE_PASS before `completed`.
- Explicit distinction between execution-channel evidence and unknown physical PC01 state.
- Contract/regression tests executing real Web Control handlers against simulated transports.

## Non-scope
- No App changes.
- No AI coordinator/model-routing changes.
- No PC01 worker/watchdog/controller runtime changes.
- No Work Management engine changes.
- No MAIN or Production release in this work order.
- No direct browser-to-shell, arbitrary command execution, browser credential entry, or secret exposure.

## Security remediation
Historical independent Web review on head `0988c2cecc21583ae3e6c9b53d650198325f7d9e` found two P0 defects:
1. OAuth callback could overwrite the Owner session cookie while clearing OAuth state.
2. `/api/control` accepted a browser-supplied GitHub PAT as a write authorization bypass.

Those findings were remediated on the branch:
- OAuth callback appends both the Owner session cookie and state-clear cookie.
- Browser GitHub PAT is not a write credential.
- Browser-origin mutation requires valid Owner session + server-side GitHub credential.
- Internal server-secret authorization is restricted to non-browser requests.
- Work Order creation uses normalized instruction fingerprints and same-process in-flight serialization to cover repeat/double-submit including concurrent calls.
- Canary operation reuses canonical `TIGERIQ_PC01_CANARY_ISSUE` and creates no duplicate canary Issue.
- Lifecycle classifier requires concrete RESULT evidence followed by trusted independent review and judge markers; closed-but-unverified work remains unverified.
- Executable OAuth regression proves callback returns both cookies and the resulting session authorizes the next request.

## Runtime freeze evidence
Latest Web runtime-changing commit is:
`1d920b0a865a3b8ee35d3c4d4d5ea8a966e8f7ba`

Vercel Preview for that commit:
- Deployment: `dpl_BR7C7U4KhpnRbbFnF5c5U5ai5rZw`
- State: READY
- Target: Preview (`target:null`)

Repository compare from `1d920b0a865a3b8ee35d3c4d4d5ea8a966e8f7ba` through pre-evidence-update head `3d1f6a77cc76e131c2c9f18434dca7e6894b5a69` changes only:
- `docs/CURRENT_STATE.md`
- `scripts/verify_queue_hygiene.mjs`
- `tests/web-control-pc01-contract.test.mjs`
- `tests/web-control-security-dedupe-gates.test.mjs`

No `api/`, `public/`, `vercel.json`, or other Web runtime source changed after `1d920b0a...` through that audited head. The evidence/documentation commits after it remain non-runtime and must still receive exact-head repository gates before handoff.

## Automated gate evidence before final evidence refresh
Pre-evidence-update head `3d1f6a77cc76e131c2c9f18434dca7e6894b5a69` passed:
- CI #251 — PASS
- Queue Hygiene #178 — PASS
- WO-012/013 Vercel Online Verify #152 — PASS

The final exact branch head after evidence/documentation refresh must independently pass the same three gates. Evidence from an older SHA must not be promoted to the final head.

## Acceptance checklist
- [x] `/` is the unified Web Control entry.
- [x] Unauthenticated/unconfigured Owner state is read-only and fail-closed.
- [x] Browser never asks for GitHub token or command secret.
- [x] Browser-supplied GitHub token cannot authorize mutation.
- [x] Browser-origin request carrying the internal server secret still cannot mutate without Owner authentication.
- [x] OAuth callback preserves Owner session while clearing OAuth state.
- [x] Work Order creation deduplicates sequential and concurrent same-fingerprint submissions within the process.
- [x] PC01 canary reuses canonical canary and does not create duplicate Issues.
- [x] Closed Issue cannot be projected as completed without concrete RESULT evidence + trusted REVIEW_PASS + trusted JUDGE_PASS in order.
- [x] Web status uses the same fail-closed lifecycle classifier.
- [x] PC01 UI does not infer physical online/offline state.
- [x] Static and executable security regression coverage exists.
- [x] Runtime source is frozen at `1d920b0a...`; later audited changes are tests/scripts/docs only.
- [ ] Final exact-head CI PASS after this evidence refresh.
- [ ] Final exact-head Queue Hygiene PASS after this evidence refresh.
- [ ] Final exact-head Vercel invariant PASS after this evidence refresh.
- [ ] Fresh independent Web Control review PASS on the final exact head.
- [ ] Real Owner Google OAuth provider/environment runtime smoke PASS.
- [x] PC01 runtime gate deferred and is not a blocker for this Web-only hardening pass.
- [x] MAIN/Production remain unchanged pending explicit Owner release authorization.

## Independent review handoff requirements
07 / Independent Review must verify the final exact PR head, not an earlier SHA:
1. no browser-controlled credential reaches a GitHub mutation without Owner authentication;
2. OAuth callback returns a durable Owner session and clears OAuth state correctly;
3. Work Order sequential/concurrent repeat paths are deduplicated;
4. canonical canary cannot create duplicates;
5. Issue close or RESULT alone cannot become completed;
6. review/judge evidence ordering and trusted provenance are fail-closed;
7. `/api/web-control-status` projects the same lifecycle truth;
8. delta after runtime commit `1d920b0a...` contains only tests/scripts/docs/state and no runtime code;
9. MAIN/Production remain unchanged.

## Release gate
Do not merge PR #117, modify MAIN, promote Production, or release WO-045 until all of the following are true on the final exact PR head:
1. CI PASS;
2. Queue Hygiene PASS;
3. WO-012/013 Vercel invariant PASS;
4. fresh independent Web Control review PASS on that exact SHA;
5. real Owner Google OAuth runtime smoke PASS in a configured provider/environment;
6. explicit Owner instruction to publish/release.

PC01 end-to-end execution remains a later integration gate before autonomous PC execution is trusted; it is not a blocker for finishing this Web-only release-candidate hardening pass.
