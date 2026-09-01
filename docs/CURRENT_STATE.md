# Current State

Date: 2026-09-01

TigerIQ AI Lab is operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Current MAIN / Production truth
- Repository: `newsdayads/tigeriq-ai-lab`.
- Audited MAIN head: `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042 secure Owner Web Control login).
- WO-040 merged as `69ef75149155c09d4618afef941e54cf02feaf79`.
- WO-041 merged as `d0b085c10a691d7c1dd41a2861253c96f5f85215`.
- WO-042 merged as `4d73bd923526aa3396a4f436332a9b863c66e172`.
- Latest previously observed Vercel Production deployment remains behind MAIN; no later Web/APP/Governance branch work is claimed live without direct Production evidence.
- Fresh GitHub branch evidence reports `main` as `protected:true`, but the branch summary exposes no required status checks (`contexts: []`, `checks: []`). Repository rulesets are still `[]`.
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

Verified prior bootstrap behavior:
- On prior exact head `71329b3321d9b736a9bbb3c16e7c65507486cad2`, structured 07 exact-head review existed and Governance Independent Review Gate run `33455971386` succeeded on rerun against the same head.
- This proves verifier/bootstrap behavior only; it does not make #113 PASS and does not authorize MAIN/Production.

Fresh governance state:
- Prior PR #118 review on `24b74b39f698dda96ff6938009f2eb46d3b5ecdd` was FAIL because this file was stale versus live repository state.
- This reconciliation commit intentionally invalidates every prior exact-head PASS; fresh CI/Queue/Governance review evidence is required on the new exact head.
- Global #113 must remain fail-closed until repository policy is independently proven to enforce PR-only mutation, required checks, no unsafe bypass, no force-push/delete, and final CURRENT_STATE freshness.

## Web Control — PR #117
- Canonical branch: `wo045/web-control-remote-ops`.
- Current exact head observed: `9ae2c998ccbb1222dd57eb4264955888904f4666`.
- Exact-head repository gates are PASS: CI `33497322162`, Queue Hygiene `33497322166`, WO-012/013 Vercel Online Verify `33497322161`.
- Vercel commit status on this exact head is still FAIL because the Hobby deployment quota is exhausted. No paid upgrade or retry-spam is authorized.
- A READY Preview exists for an older branch head, but it is not exact-head runtime proof for `9ae2c998...`; therefore `WEB_CONTROL_SINGLE_DOOR_E2E_PASS` is not emitted yet.
- Web Control implements Owner/TigerIQ auth separation, server-only write credential path, canonical Work Order dedupe, server-owned evidence reference, independent Reviewer/Judge gates, mobile status UI and bounded autonomous backlog processing.
- Groq Free remains the verified cloud runtime path. Gemini is permitted only when a real free-tier key/config exists; OpenRouter is restricted to free routing by default. No paid provider fallback is automatic.
- Remaining P0 runtime sequence: wait for zero-cost exact-head READY Preview; run authenticated harmless Single Door canary; prove duplicate reuse, result/evidence, Reviewer/Judge and status projection on the exact runtime; then obtain fresh runtime-aware independent review.
- MAIN/Production remains unchanged.

## PC01 security — #114 / PR #116
- Canonical hardening branch: `wo045/pc01-autonomy-hardening` on top of `wo011/pc01-remote-exec`.
- Current exact head observed: `5b07e5865265376f4e380142ac5c2ca4a048792b`.
- Existing repository CI/Secure Worker gates are green, but fresh independent security review `5077674476` is FAIL on this exact head.
- Raw model-controlled shell/argv is removed and `repo.test` is exact-allowlisted, but remaining blockers are material:
  1. AI read scope is still workspace-wide minus filename heuristics and allows protected/local configuration surfaces such as `.git/**`;
  2. public evidence can include raw tool/file output and current redaction is not a fail-closed sensitive-data boundary;
  3. model-role independence is based on distinct configured model-name strings rather than immutable model digest/fingerprint where available.
- #114 must not close and Secure Worker V3 must not be activated as autonomous-safe until these blockers are remediated and fresh exact-head security review PASS exists.

## Work Management / AI Gateway / shared Android v0.7 contract
- PR #126 (`wo047/android-worker-core-v07`) is the frozen Employee/Device/Job Core contract branch at exact `7bbaec2e503f579f876d6af96c59911d3a618b84`.
- PR #127 (`wo047/api-first-inference-gateway`) is the frozen server-side inference Gateway branch at exact `6c8d006054c04330d353a61acacc7107d53bf4e7`.
- Gate #130 / PR #131 provides the cross-stream integration proof and emitted canonical `CONTRACT_V07_READY`.
- Parent Work Management PR #115 remains open/release-staged; its canonical issue was closed only after independent repository gate evidence. Do not create duplicate implementation streams.
- These branches do not authorize MAIN/Production release by themselves.

## Android APP v0.7 — PR #132
- Canonical branch: `wo048/android-v07-api-first-worker`, stacked on the phone-first Android baseline.
- Current exact head observed: `76197e75517adf4c6eb4a965f16af7b318a10a1d`.
- Exact-head gates: CI `33489016994` PASS; Android Worker `33489016990` PASS.
- Fresh independent repository/build review `5077718726` emitted `APP_V07_INDEPENDENT_REVIEW_PASS` on this exact head.
- The current v0.7 APK surface is API-first and bank-safety hardened: source manifest declares only `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`; Accessibility/overlay/package automation/legacy foreground controller surfaces are absent from the v0.7 manifest; direct legacy v0.6 worker sources are excluded from packaging; the exact-run APK artifact was independently inspected for expected v0.7 classes and absence of the known legacy automation/provider-key markers.
- Prior security/correctness remediation remains in branch history: collision-resistant Employee+Device key identity, verified hardware-backed key policy, one-time enrollment bootstrap material, short-lived TigerIQ session use, authoritative bindingId, expectedEvidence enforcement, non-persistent raw lease authority, unique WorkManager and bounded retry/recovery.
- Repository/software gate is PASS only. Physical Z Flip/Z Fold enrollment, real hardware-backed Keystore behavior, reboot/network recovery, stable-signed install/update continuity and real Job -> Inference -> Result/Evidence execution remain mandatory before APP release/DONE.
- Banking-app anti-fraud compatibility is external/proprietary and is not claimed from repository tests.

## Multi-AI subscription orchestration — #133 / PR #134
- P1 branch `wo048/multi-ai-subscription-orchestration` prepares a safe PC01 capability probe for Gemini CLI, Claude CLI, Ollama and git without adding API billing or provider secrets.
- Repository code can be audited remotely, but actual installed/authenticated capability and cached subscription login state can only be proven on PC01.
- No subscription CLI is assumed unlimited; quota/auth failures must fail closed or use an already-configured free/local fallback.

## Canonical PC01 / physical-device truth
- Issue #57 is the single canonical PC01 ingress recovery work order.
- Issue #58 is the single deterministic `system.status` canary.
- Issue #100 is the single canonical Workforce Controller deployment job.
- Issue #137 asks whether PC01 is operating and therefore requires actual PC/device evidence; cloud AI must not fabricate the answer.
- Current repository evidence records `REAL_BLOCKER_BOOTSTRAP_DEADLOCK`: neither the GitHub issue worker nor attempted self-hosted runner ingress accepted the recovery workload at the recorded audit point.
- Repository/CI evidence is never PC01/Tailscale runtime evidence. Do not create duplicate recovery/canary issues and do not retry physical jobs through cloud AI without a real ingress.

## Release path from current state
1. Remediate PR #116 on its owning security branch; run exact-head regression/security gates; obtain fresh independent PASS for #114.
2. Keep PR #118 on its governance branch; after this CURRENT_STATE refresh, require fresh exact-head CI/Queue/Governance independent review. Keep global #113 FAIL until live repository policy itself is sufficient.
3. Keep PR #117 unchanged while Vercel Hobby quota blocks exact-head runtime; continue repo-side work rather than retry-spam. When exact-head Preview exists, run the full Single Door runtime gate.
4. Keep PR #132 repository-frozen at the reviewed head unless an owning APP fix is required; run physical-device/stable-signing/E2E gates before APP release.
5. Continue P1 #133/PR #134 and other non-conflicting repo work while P0 paths wait on CI/external/physical gates.
6. Do not merge MAIN or promote Production unless all applicable gates are simultaneously PASS and Owner release authorization applies.

## External / deferred boundaries
- Vercel filesystem is stateless and is never durable Workforce storage.
- Paid provider/billing activation is not authorized by repository implementation alone.
- No provider credentials, Owner credentials, signing secrets or private keys may enter source control, logs or public artifacts.
- If physical install/login/2FA, repository Settings, or deployment quota is the only blocker for one path, record it explicitly and continue all other safe work.