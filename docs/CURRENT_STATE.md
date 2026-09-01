# Current State

Date: 2026-09-01

TigerIQ AI Lab is operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Current MAIN / Production truth
- Repository: `newsdayads/tigeriq-ai-lab`.
- Audited MAIN head remains `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042 secure Owner Web Control login).
- WO-040 merged as `69ef75149155c09d4618afef941e54cf02feaf79`.
- WO-041 merged as `d0b085c10a691d7c1dd41a2861253c96f5f85215`.
- WO-042 merged as `4d73bd923526aa3396a4f436332a9b863c66e172`.
- No later Web/APP/Governance/PC01/Multi-AI branch work is claimed live on MAIN/Production without direct runtime evidence and Owner release authorization.
- Fresh GitHub branch evidence reports `main` as `protected:true`, but required status checks remain empty (`contexts: []`, `checks: []`) and repository rulesets remain `[]`.
- Therefore global governance issue #113 remains FAIL: PR-only mutation, required checks, trusted independent review, bypass behavior, force-push and deletion policy are not yet independently proven enforced on live MAIN.
- Every currently open implementation/release PR has a `do-not-merge` label as an additional visual guard while MAIN enforcement is incomplete. This label is not a substitute for branch protection/rulesets.

## Canonical autonomous operation feed — #138
- Issue #138 is the single canonical `TIGERIQ_AUTONOMY_FEED_V1` status feed.
- It is state-only and is intentionally excluded from cloud auto-work consumption.
- Each autonomous cycle must update Current Action, Execution Channel, Last Progress, Next Action, Blocker and Updated At from real evidence only.

## Governance enforcement work — #113 / PR #118
PR #118 (`wo046/current-state-governance-reconcile`) owns governance implementation/state reconciliation.

### Security finding discovered after the prior PASS
The former independent-review gate is INVALIDATED for release purposes. It had two architectural weaknesses:
1. the workflow checked out PR-head code before running the verifier, so a PR could modify the verifier/workflow it was being judged by;
2. the verifier accepted structured PASS text from comments/reviews without proving a formal approval by a reviewer identity distinct from the PR author.

The former exact `558de5227e74fb3fdfa61c378b5e64c7912758f4`, review `5079723679` and Governance run `33523704318` are historical evidence only and MUST NOT be reused as a secure merge gate.

### Hardened design now implemented on PR #118
- `.github/workflows/governance-independent-review.yml` uses `pull_request_target`, so the workflow definition executes from trusted base context rather than PR-controlled code.
- Checkout is pinned to `${{ github.event.pull_request.base.sha }}` with `persist-credentials: false`; the gate never executes PR-head verifier/workflow code.
- `scripts/verify-independent-review-gate.mjs` accepts pull-request reviews only; issue comments are not independent evidence.
- A qualifying review must be formal `APPROVED`, have `review.commit_id == HEAD_SHA`, come from a GitHub login different from the PR author, and include `TIGERIQ_INDEPENDENT_REVIEW_PASS`, `REVIEW_ROLE: 07`, exact head SHA and typed `EVIDENCE_REF`.
- Regression tests reject self-forged markers, COMMENTED/DISMISSED review states, stale-SHA approvals, missing evidence and PR-head checkout.
- Security implementation head `6dda88e646fa67a2aad09d3ea1b4da6a7ea8f06c` passed CI `33527235293`, Queue Hygiene `33527235245` and Vercel Verify `33527235246`; CI included the new security regressions, Playwright smoke and build.
- Official GitHub Actions behavior confirms `pull_request_target` uses trusted base context; executing PR code from that context must remain forbidden.

### Activation boundary
- The hardened workflow is not authoritative merely because it exists on PR #118. `pull_request_target` trusted behavior must come from a workflow already present on trusted MAIN.
- Therefore activation requires an explicitly authorized integration of the hardened governance code to MAIN, followed by live repository Settings that require the intended checks/policies.
- A genuinely distinct reviewer GitHub identity/App must be available to submit the formal exact-head APPROVED review; same-account COMMENT text is intentionally rejected.
- Until activation and live Settings proof exist, global #113 remains FAIL. Do not claim a secure Governance PASS from the old gate.

## Web Control — PR #117
- Canonical branch: `wo045/web-control-remote-ops`.
- Final reviewed repository head: `4f9014a3392cd9ce98bd2abb138123b6d103357e`.
- Exact-head repository gates PASS: CI `33523361282` (typecheck, unit tests, Playwright smoke, build), Queue Hygiene `33523361514`, Vercel Verify `33523361238`.
- Fresh independent Web routing review `5079682318` is PASS for repository scope / runtime pending.
- Exact-head Vercel commit status remains FAIL with Hobby `build-rate-limit`; no paid upgrade or retry-spam is authorized and no READY deployment is claimed for `4f9014a...`.
- Web Control retains Owner/TigerIQ auth separation, server-only write credential path, canonical Work Order dedupe, server-owned SHA256 evidence reference, mobile status UI and bounded autonomous backlog processing.
- Historical #135 is handled at repository level: server owns SHA256 `EVIDENCE_REF`; the scheduler allows exactly one migration retry only for the old model-side SHA/cryptographic-hash blocker; generic bounded blockers remain non-retryable and a second matching legacy blocker fails closed. #135 metadata now points to final Web head `4f9014a...` and remains open until the logic runs on an exact-head READY runtime.
- Single Door classifies execution before any cloud model invocation. PC01/Windows/Scheduled Task/Watchdog/Tailscale/Ollama operational status, runtime audit/log, reboot/deploy/connect actions route to `pc01-runtime-required` with `CLOUD_EXECUTOR_ALLOWED=false`. Z Flip/Z Fold/phone/device install/smoke work routes to `device-runtime-required`, also cloud-blocked.
- Explicit code/repo/docs/architecture analysis remains cloud-eligible when no hard runtime action is requested; regression tests cover runtime audit versus repo audit.
- Issue #137 is explicitly `pc01-runtime-required`, `PC01_REQUIRED=true`, `CLOUD_EXECUTOR_ALLOWED=false`.
- Remaining Web runtime sequence: wait for zero-cost READY deployment whose `githubCommitSha` equals `4f9014a...`; prove physical instruction creates no cloud CLAIM; run #135 migration once; run harmless Single Door canary/status/dedupe/Reviewer/Judge; obtain fresh runtime-aware review.

## AI Coordinator / Work Management / shared v0.7 contracts
- PR #111 AI Coordinator is repository/engineering PASS at exact `1f8261c59b6406a471226a762a3b724d5dad93dd`; independent review `5063427059` emitted `AI_COORDINATOR_INDEPENDENT_PASS`. It is release-staged only; no live-provider/Production claim.
- PR #115 Work Management is repository PASS at exact `97641f6895e829aa72f252fdfd03d7b4dc8e6364`; review `5064570364` emitted `WO044_INDEPENDENT_REVIEW_PASS`. Canonical #112/#119 are completed; do not create duplicate implementation streams.
- PR #126 Android v0.7 Employee/Device/Job Core is frozen at `7bbaec2e503f579f876d6af96c59911d3a618b84`; gate #128 emitted `WO047_ANDROID_V07_REVIEW_PASS`.
- PR #127 API-first Inference Gateway is frozen at `6c8d006054c04330d353a61acacc7107d53bf4e7`; gate #129 emitted `WO047_INDEPENDENT_REVIEW_PASS`.
- Gate #130 / PR #131 exact `9ce2aea4967c6986601f136b3f7491f8fea8c9ff` passed independent integration review and emitted canonical `CONTRACT_V07_READY`.
- These PRs are dependencies/release-staged artifacts, not separate unfinished implementation streams and not authority to merge MAIN by themselves.

## PC01 security — #114 / PR #116
- Canonical branch: `wo045/pc01-autonomy-hardening` on top of `wo011/pc01-remote-exec`.
- Reviewed exact head: `2b941450f541643b9f4b952493dfd2fc612f30f2`.
- CI `33506910934` PASS; WO-045 Secure Worker `33506910959` PASS; independent security review `5078356652` reports repository security PASS.
- Raw model-controlled shell/argv is absent; AI reads are explicit repository-tracked/AI-created safe paths; protected/local credential surfaces are denied; public evidence excludes raw file content and uses final secret redaction/fail-closed suppression; Executor/Reviewer/Judge require three distinct immutable Ollama digests and identities are rechecked after execution.
- Reviewed secure bootstrap validates Windows, exact branch/SHA, tests, watchdog syntax, Scheduled Task persistence, backups, preflight, Worker restart and watchdog smoke before any secure-bootstrap PASS claim.
- Repository/security scope PASS only. #114 stays open until least-privilege OS execution, live activation, #57 ingress, #58 deterministic CLAIM+RESULT and #100 Controller evidence exist on PC01.

## Android phone-first worker — #108 / PR #109
- Canonical branch: `wo012/android-phone-first-worker`; exact head `2c65ab71c331964a69ca418d4450c10ef3b067c2`; draft/unmerged.
- Gates PASS: CI `33519326741`, Queue `33519326892`, Vercel Verify `33519326831`, Android Worker `33519326746`; review `5079279419` repository/code PASS.
- Local task history is bounded; Gemini extraction uses privacy-safe pre-submit boundary hashes/marker count and current-prompt evidence; regression coverage includes stale/prior/duplicate/restart/login/provider-limit/timeout cases.
- Physical exact-head stable-signed Z Flip/Z Fold install/smoke, Samsung restrictions, one harmless Gemini task and restart/background behavior remain mandatory; stale APK evidence cannot be reused.

## Android APP v0.7 — PR #132
- Canonical branch: `wo048/android-v07-api-first-worker`; exact head `76197e75517adf4c6eb4a965f16af7b318a10a1d`.
- CI `33489016994` PASS; Android Worker `33489016990` PASS; independent repository/build review `5077718726` emitted `APP_V07_INDEPENDENT_REVIEW_PASS`.
- API-first/bank-safety surface declares only `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`; legacy Accessibility/overlay/package automation surfaces are excluded from v0.7 packaging and known provider-key markers are absent from inspected exact-run APK artifact.
- PR metadata is reconciled to repository/build PASS rather than stale “M1 started” text.
- Physical enrollment, hardware-backed Keystore behavior, reboot/network recovery, stable-signed update continuity and real Job -> Inference -> Result/Evidence remain mandatory before release. External banking-app compatibility is not claimed from repository tests.

## Multi-AI zero-cost orchestration — #133 / PR #134
- Canonical branch: `wo048/multi-ai-subscription-orchestration`; exact head `1d808ce46135a7427711608c2dec8cfdbd46810e`.
- CI `33518393104`, Queue `33518392985`, Probe Guard `33518393107`, Vercel Verify `33518392986` PASS; independent cost/security review `5079166931` PASS for repository zero-cost scope.
- Gemini blocks API/Vertex/ADC/base-url/persisted non-account routes; Claude accepts only independently proven Claude App Pro/Max and rejects API/gateway/Bedrock/Vertex/Foundry; OpenRouter is hard-coded to `openrouter/free`; Ollama is local zero-cost fallback.
- No-network self-test covers billing-route denial, config classification, redaction and bounded timeout/kill.
- Real PC01 provider login/quota/capability, parallel executor/reviewer scheduling, reboot recovery and Ollama fallback still require physical E2E evidence.

## Canonical PC01 / physical-device truth
- #57 is the canonical PC01 ingress recovery work order.
- #58 is the deterministic `system.status` canary.
- #100 is the canonical Workforce Controller deployment job.
- #137 is PC01-only and cloud auto-work must not consume it.
- Current evidence still records missing active ingress/bootstrap deadlock. Repository/CI evidence is never PC01/Tailscale runtime evidence; do not create duplicate physical jobs or retry them through cloud AI.

## Release path from current state
1. Complete exact-head CI/Queue verification for this CURRENT_STATE commit and keep PR #118 `do-not-merge`; the trusted-review design is repository-hardened but cannot become authoritative until explicitly integrated to trusted MAIN.
2. Obtain/configure a genuinely separate reviewer identity/App for formal exact-head APPROVED reviews; same-author/self-comment review must fail closed.
3. After explicit Owner authorization, integrate governance hardening, then configure/audit live MAIN Settings: required checks, PR-only, trusted review, safe bypass, no force-push/delete. Only then can #113 close.
4. Freeze Web PR #117 at `4f9014a...`; wait for exact-head zero-cost Vercel READY, then prove physical pre-routing, #135 one-time migration and full Single Door runtime gate.
5. Freeze PR #116 until physical #57/#58/#100 evidence; freeze #108/#109 and #132 until exact-head device smoke; freeze #134 until PC01 provider E2E.
6. Do not merge MAIN or promote Production unless applicable gates are simultaneously PASS and explicit Owner release authorization applies.

## External / deferred boundaries
- Vercel filesystem is stateless and never durable Workforce storage.
- Paid provider/billing activation is not authorized by repository implementation alone.
- No provider credentials, Owner credentials, signing secrets or private keys may enter source control, logs or public artifacts.
- If physical install/login/2FA, repository Settings, separate reviewer identity, or deployment quota is the only blocker, record it explicitly and continue other safe work.
