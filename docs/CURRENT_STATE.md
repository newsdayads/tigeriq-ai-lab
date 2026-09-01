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
- Fresh GitHub branch evidence reports `main` as `protected:true`, but the branch summary exposes no required status checks (`contexts: []`, `checks: []`). Repository rulesets remain `[]`.
- Therefore global governance issue #113 remains FAIL: protection exists, but PR-only mutation, required checks, bypass behavior, force-push and deletion policy are not yet independently proven sufficient.

## Canonical autonomous operation feed — #138
- Issue #138 is the single canonical `TIGERIQ_AUTONOMY_FEED_V1` status feed.
- It is state-only and is intentionally excluded from cloud auto-work consumption.
- Each autonomous cycle must update Current Action, Execution Channel, Last Progress, Next Action, Blocker and Updated At from real evidence only.

## Governance enforcement work — #113 / PR #118
PR #118 (`wo046/current-state-governance-reconcile`) is the governance implementation branch.

Implemented on the branch:
- `.github/workflows/ci.yml` includes `push` to `main` and `merge_group`, enabling post-merge/main-SHA CI evidence after authorized integration.
- `.github/workflows/governance-independent-review.yml` adds a machine-verifiable independent-review status gate for non-draft PRs.
- `scripts/verify-independent-review-gate.mjs` requires structured exact-head `TIGERIQ_INDEPENDENT_REVIEW_PASS`, `REVIEW_ROLE: 07`, exact HEAD SHA and typed `EVIDENCE_REF`.
- `docs/governance/MAIN_PROTECTION_V1.md` defines required MAIN protection and the one-time bootstrap procedure.

Fresh governance-branch behavior:
- Prior exact head `c1a8cb8d699fd03c40698036520a8fd07690f2cc` had CI, Queue Hygiene, Vercel Verify and Governance Independent Review Gate PASS after fresh structured 07 review.
- Subsequent state-reconciliation head `05a71e9b94336ab0adfa103ebd89fabff34af4c1` had CI/Queue/Vercel PASS; its Governance gate failed because no exact-head structured review was intentionally submitted before APP state changed again.
- This CURRENT_STATE reconciliation creates a newer exact head and invalidates every prior exact-head review. Fresh exact-head gates and structured 07 review are required again.
- Global #113 remains fail-closed until live repository policy itself is independently proven to enforce PR-only mutation, required checks, safe bypass policy, no force-push/delete, and final CURRENT_STATE freshness.

## Web Control — PR #117
- Canonical branch: `wo045/web-control-remote-ops`.
- Current exact head: `9ae2c998ccbb1222dd57eb4264955888904f4666`.
- Exact-head repository gates are PASS: CI `33497322162`, Queue Hygiene `33497322166`, WO-012/013 Vercel Online Verify `33497322161`.
- Fresh status still reports Vercel failure with Hobby `build-rate-limit`; no paid upgrade or retry-spam is authorized.
- The READY Preview previously observed for this branch is bound to stale commit `890456ccfdce9d9f681520b22d1e79250d802096`, not current exact head `9ae2c998...`; therefore `WEB_CONTROL_SINGLE_DOOR_E2E_PASS` is not emitted.
- Web Control repository implementation includes Owner/TigerIQ auth separation, server-only write credential path, canonical Work Order dedupe, server-owned evidence reference, independent Reviewer/Judge gates, mobile status UI and bounded autonomous backlog processing.
- Groq Free remains the verified cloud runtime path. No paid provider fallback is automatic.
- Remaining P0 runtime sequence: wait for a zero-cost READY Preview whose `githubCommitSha` equals the exact head; run authenticated harmless Single Door canary; prove duplicate reuse, result/evidence, Reviewer/Judge, auto-work lock/fail-closed and status projection; then obtain fresh runtime-aware independent review.
- MAIN/Production remains unchanged.

## PC01 security — #114 / PR #116
- Canonical hardening branch: `wo045/pc01-autonomy-hardening` on top of `wo011/pc01-remote-exec`.
- Current exact head: `2b941450f541643b9f4b952493dfd2fc612f30f2`.
- Exact-head CI `33506910934` PASS and WO-045 PC01 Secure Worker `33506910959` PASS.
- Fresh 07 independent repository-security re-review is PASS on this exact head.
- Verified remediation: raw model-controlled shell/argv is absent; AI read scope is explicit and limited to repository-tracked/AI-created safe paths; `.git/**`, `.github/**`, `scripts/pc-worker/**`, sensitive-name and untracked local configuration paths are denied; public evidence excludes raw file content and applies final secret redaction/fail-closed suppression; Executor/Reviewer/Judge independence is bound to three distinct immutable Ollama model digests and rechecked after execution.
- Repository/security implementation scope for #114 is PASS only. #114 remains open until least-privilege OS execution, live PC01 activation, network/runtime behavior and #57/#58/#100 are proven on the physical machine.

## Android phone-first worker — #108 / PR #109
- Canonical branch: `wo012/android-phone-first-worker`.
- Current exact head: `2c65ab71c331964a69ca418d4450c10ef3b067c2`; PR #109 remains draft and unmerged.
- Exact-head gates PASS: CI `33519326741`; Queue Hygiene `33519326892`; Vercel Verify `33519326831`; Android Worker `33519326746`.
- Fresh exact-head independent APP re-audit `5079279419` is PASS for repository/code scope.
- The prior code blockers are remediated:
  1. `LocalTaskStore` keeps bounded terminal history (12 records) with prompt/state/result-or-error + `startedAt`/`finishedAt`; Home renders the five newest records.
  2. Gemini result extraction now captures a privacy-safe pre-submit boundary using SHA-256 hashes of prior candidate text plus completion-marker count; raw prior chat is not persisted. Result acceptance requires the current prompt anchor, excludes baseline hashes, requires a newer completion-marker count and bounded age/length; SUBMITTED state without a persisted boundary fails closed after restart.
  3. Executable regressions cover prior-chat exclusion, stale marker, duplicate text/events, missing prompt anchor, restart boundary, login, provider limit, timeout and response evidence thresholds; Android CI runs `:app:testDebugUnitTest` before build/signing-contract checks.
- Previously documented pilot APK SHA/certificate proof belongs to an older head and is not valid physical evidence for this exact head.
- Physical Z Flip/Z Fold smoke, exact-head stable-signed install/update, Samsung restricted-setting/Advanced Protection behavior, one harmless real Gemini task and background/restart reliability remain mandatory before release/DONE.

## Work Management / AI Gateway / shared Android v0.7 contract
- PR #126 (`wo047/android-worker-core-v07`) is the frozen Employee/Device/Job Core contract branch at exact `7bbaec2e503f579f876d6af96c59911d3a618b84`.
- PR #127 (`wo047/api-first-inference-gateway`) is the frozen server-side inference Gateway branch at exact `6c8d006054c04330d353a61acacc7107d53bf4e7`.
- Gate #130 / PR #131 provides the cross-stream integration proof and emitted canonical `CONTRACT_V07_READY`.
- Parent Work Management PR #115 remains open/release-staged; its canonical issue was closed only after independent repository gate evidence. Do not create duplicate implementation streams.
- These branches do not authorize MAIN/Production release by themselves.

## Android APP v0.7 — PR #132
- Canonical branch: `wo048/android-v07-api-first-worker`, stacked on the phone-first Android baseline.
- Current exact head: `76197e75517adf4c6eb4a965f16af7b318a10a1d`.
- Exact-head gates: CI `33489016994` PASS; Android Worker `33489016990` PASS.
- Fresh independent repository/build review `5077718726` emitted `APP_V07_INDEPENDENT_REVIEW_PASS` on this exact head.
- The current v0.7 APK surface is API-first and bank-safety hardened: source manifest declares only `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`; Accessibility/overlay/package automation/legacy foreground controller surfaces are absent from the v0.7 manifest; direct legacy v0.6 worker sources are excluded from packaging; the exact-run APK artifact was independently inspected for expected v0.7 classes and absence of known legacy automation/provider-key markers.
- Repository/software gate is PASS only. Physical Z Flip/Z Fold enrollment, hardware-backed Keystore behavior, reboot/network recovery, stable-signed install/update continuity and real Job -> Inference -> Result/Evidence execution remain mandatory before APP release/DONE.
- Banking-app anti-fraud compatibility is external/proprietary and is not claimed from repository tests.

## Multi-AI zero-cost orchestration — #133 / PR #134
- Canonical branch: `wo048/multi-ai-subscription-orchestration`.
- Current exact head: `1d808ce46135a7427711608c2dec8cfdbd46810e`.
- Exact-head gates PASS: CI `33518393104`; Queue Hygiene `33518392985`; WO-048 Multi-AI Probe Guard `33518393107`; Vercel Verify `33518392986`.
- Fresh independent cost/security re-review `5079166931` is PASS for repository zero-cost/fail-closed scope.
- Repository policy fails closed on detected Gemini API/Vertex/ADC/base-url routes and scans user/project Gemini config for non-account routes; Claude accepts only independently proven Claude App Pro/Max auth and rejects API/gateway/Bedrock/Vertex/Foundry; OpenRouter is hard-coded to `openrouter/free` with non-free models/paid fallback disabled; Ollama remains local zero-cost fallback.
- Deterministic no-network self-test covers Gemini/Claude billing-route refusal, persisted Gemini route classification, secret redaction and bounded timeout/kill behavior.
- This PASS does not prove real PC01 provider readiness or complete #133: Gemini/Claude/OpenRouter login/quota/capability, parallel executor/reviewer scheduling, reboot recovery and Ollama fallback still require physical PC01 E2E evidence.

## Canonical PC01 / physical-device truth
- Issue #57 is the single canonical PC01 ingress recovery work order.
- Issue #58 is the single deterministic `system.status` canary.
- Issue #100 is the single canonical Workforce Controller deployment job.
- Issue #137 asks whether PC01 is operating and therefore requires actual PC/device evidence; cloud AI must not fabricate the answer.
- Current evidence records a bootstrap deadlock / missing active ingress: repository-side work cannot prove that the physical worker is consuming GitHub jobs.
- Repository/CI evidence is never PC01/Tailscale runtime evidence. Do not create duplicate recovery/canary issues and do not retry physical jobs through cloud AI without a real ingress.

## Release path from current state
1. Keep PR #116 repository-frozen at its reviewed PASS head unless an owning security fix is required; wait for physical #57/#58/#100 runtime proof before closing #114 or claiming PC01 autonomous-safe.
2. Re-run exact-head governance CI/Queue/Governance gate and obtain fresh structured 07 review after this CURRENT_STATE refresh. Keep global #113 FAIL until repository Settings policy itself is sufficient.
3. Keep PR #117 unchanged while Vercel Hobby quota blocks exact-head runtime; continue safe repo-side work instead of retry-spam. When exact-head Preview exists, run the full Single Door runtime gate.
4. Keep #108/PR #109 repository-frozen at its exact-head code PASS unless an owning fix is required; perform exact-head stable-signed Z Flip/Z Fold physical smoke before release.
5. Keep PR #132 repository-frozen at the reviewed head unless an owning APP fix is required; run physical-device/stable-signing/E2E gates before APP release.
6. Keep PR #134 repository-frozen at zero-cost guard PASS while full #133 waits on PC01 runtime/provider E2E.
7. Do not merge MAIN or promote Production unless all applicable gates are simultaneously PASS and Owner release authorization applies.

## External / deferred boundaries
- Vercel filesystem is stateless and is never durable Workforce storage.
- Paid provider/billing activation is not authorized by repository implementation alone.
- No provider credentials, Owner credentials, signing secrets or private keys may enter source control, logs or public artifacts.
- If physical install/login/2FA, repository Settings, or deployment quota is the only blocker for one path, record it explicitly and continue all other safe work.
