# Current State

Date: 2026-09-01

TigerIQ AI Lab is operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Current MAIN / Production truth
- Repository: `newsdayads/tigeriq-ai-lab`.
- Audited MAIN head: `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042 secure Owner Web Control login).
- WO-040 merged as `69ef75149155c09d4618afef941e54cf02feaf79`.
- WO-041 merged as `d0b085c10a691d7c1dd41a2861253c96f5f85215`.
- WO-042 merged as `4d73bd923526aa3396a4f436332a9b863c66e172`.
- Latest observed Vercel Production deployment remains `69ef75149155c09d4618afef941e54cf02feaf79` (WO-040). MAIN is ahead of Production; do not claim later Web/APP/Governance work is live until a real Production deployment is observed.
- Vercel Hobby deployment quota has been hit during this operating window. Avoid deployment retry loops and continue non-Vercel work while quota is constrained.
- MAIN is still reported `protected:false`; repository rulesets remain absent. This is the canonical P0 governance defect tracked by #113.

## Governance enforcement work — #113 / PR #118
PR #118 (`wo046/current-state-governance-reconcile`) is now the governance implementation branch, not documentation-only.

Implemented on the branch:
- `.github/workflows/ci.yml` now includes `push` to `main` and `merge_group`, so after merge it can provide full post-merge/main-SHA CI evidence and can support merge-queue exact-merge verification.
- `.github/workflows/governance-independent-review.yml` adds a machine-verifiable independent-review status gate for non-draft PRs.
- `scripts/verify-independent-review-gate.mjs` requires a structured exact-head PASS marker containing `TIGERIQ_INDEPENDENT_REVIEW_PASS`, `REVIEW_ROLE: 07`, exact HEAD SHA and typed `EVIDENCE_REF`.
- This CURRENT_STATE snapshot is refreshed to include the current Web, Gateway/Work Management integration and Android v0.7 streams.

Still external / not yet enforced:
- GitHub repository policy itself must protect `main` via branch protection or ruleset and make PR-only mutation mandatory.
- Required status checks must include full `CI / verify` and `Governance Independent Review Gate / independent-review` (plus any other release checks selected by 07/Owner).
- Until that repository policy is actually enabled and independently re-audited, #113 remains FAIL and MAIN/Production release stays fail-closed.

## Web Control — PR #117
- Canonical branch: `wo045/web-control-remote-ops`.
- Current exact head observed: `11cf9408e0238010458942c0e1ab45ea25e0d8fa`.
- Latest runtime-changing commit: `eb80104649ad8d1795f8aea38e57bc2feed0f03b`; later exact-head changes are tests only.
- UI now uses primary brand `TigerIQ AI`; `Web Control` is a module/subtitle.
- Top-right account UX is `Đăng nhập/Tài khoản`; signed-out popover includes `Tiếp tục với Google`; signed-in view is designed for Google avatar/name/email plus TigerIQ authorization role; logout clears Owner session and OAuth-state cookies.
- Google identity and TigerIQ authorization remain separate. Current real authorization is Owner-only; future Admin/Nhân viên/Chỉ xem vocabulary must not be reported as implemented backend RBAC until 06 adds it.
- Floating refresh remains on the right below the account region for mobile one-hand use; `Nhân sự AI` remains an internal module.
- Exact-head repository gates reported PASS: CI #296 / `33385194823`, Queue Hygiene #201 / `33385194726`, Vercel Verify #175 / `33385194747`.
- Previous 07 Web PASS is historical because runtime changed. Fresh 07 review is required on exact head `11cf9408...`.
- Live Owner auth status is still `configured:false`, `authenticated:false`, `role:null`; therefore `OWNER_OAUTH_SMOKE_PASS` is not claimed.
- Owner publication intent is recorded, but release is authorized only when fresh Web 07 PASS + real Owner OAuth smoke + governance #113 PASS are simultaneously true.

## Work Management / AI Gateway / shared Android v0.7 contract
- PR #126 (`wo047/android-worker-core-v07`) is the frozen Employee/Device/Job Core contract branch at exact `7bbaec2e503f579f876d6af96c59911d3a618b84`.
- PR #127 (`wo047/api-first-inference-gateway`) is the frozen server-side inference Gateway branch at exact `6c8d006054c04330d353a61acacc7107d53bf4e7`.
- Gate #130 / PR #131 provides the cross-stream integration proof and emitted canonical `CONTRACT_V07_READY`; APP implementation is therefore unlocked.
- These components do not authorize MAIN/Production release by themselves.

## Android APP v0.7 — PR #132
- Canonical branch: `wo048/android-v07-api-first-worker` stacked on the phone-first Android baseline.
- Current exact head observed: `74b388467ee0a21a7a653e4c8bdda1fd66249ac4`.
- PR remains draft. 02 emitted `READY_FOR_INDEPENDENT_REVIEW` on this exact head; CI #319 / `33409005834` and Android Worker #70 / `33409005762` are PASS.
- 07 first emitted a repository/software PASS, then a later review on the same exact head superseded that result with `APP_V07_INDEPENDENT_REVIEW_FAIL`; this later FAIL is authoritative until remediated and re-reviewed.
- Latest 07 blockers on exact head `74b388...`:
  1. Enrolled authoritative `bindingId` is not persisted/bound to the device profile/key and therefore session/lease/result paths cannot fail closed on wrong/replaced/stale binding identity.
  2. Authoritative Job `expectedEvidence` is not enforced before submitting `status:"completed"`; generic evidence can currently satisfy code paths without proving the declared evidence contract.
  3. Raw lease credential is persisted across process/reboot in local encrypted storage, conflicting with the prepared v0.7 contract that durable checkpoint state retain only non-secret lease identity/hash/expiry and reacquire authority after recovery.
- Earlier KeyStore alias collision, hardware-backing truth, bootstrap/session-lifecycle, FCM wake-only, WorkManager/retry and core API-first findings were reported remediated on this head, but do not override the three later blockers.
- No APP release is authorized. Physical-device enrollment/Keystore behavior, reboot/network smoke, stable-signed install/update continuity and real end-to-end execution remain required after repository/software 07 PASS.
- No provider API key, GitHub PAT or Owner credential may be embedded in APK/source/resources/logs/evidence. v0.7 execution must not use Accessibility as the AI execution engine.

## Work Management parent
- PR #115 remains the parent Work Management stream. Its later exact-head work has independent-review history and is not the current release bottleneck; do not create a duplicate Work Management implementation stream.

## Canonical PC01 / device truth
- PC01 is currently deferred by Owner instruction and is not a blocker for current Web/API-first Android work.
- Issue #100 remains the canonical physical Workforce Controller deployment job; historical lack of CLAIM/RESULT must not be converted into a runtime PASS.
- Issue #58 remains the canonical deterministic PC01 autonomy canary; issue #57 remains the canonical PC01 recovery work order. Do not create duplicate PC01 recovery/canary streams.
- Repository/CI evidence is never PC01/Tailscale runtime evidence. Never infer a live listener, heartbeat, pairing or durable PC01 state without direct runtime evidence.

## Verified historical Workforce software baseline
WO-024 through WO-030 established durable Workforce contracts and Controller/Worker foundations: organization hierarchy, node registry/capability scheduling, Task Packet/Result/Evidence contracts, concurrency/idempotency/bounded retries/lease recovery, PC01 FileJournal durability/hash-chain evidence, scoped credentials, P-256 pairing proof, private Controller API, Android Worker identity/runtime/secure-store foundations, Farm Gateway adapter boundary, and simulator/CI proof of parallel workers plus independent Reviewer/Judge behavior.

WO-031 added the executive Workforce/Company Command Center. WO-032 added the Z Flip 7 pilot employee UI/profile and buildable Android artifact. WO-034 added trusted Controller pairing, tailnet-scoped Controller URL policy, employee self-enrollment and authenticated heartbeat. WO-035 made the Command Center the preferred installed-PWA entry.

WO-036 through WO-042 are repository/software milestones only unless separately backed by physical/runtime/Production evidence. In particular, WO-042 secure Owner Web Control login remains fail-closed until real deployment OAuth configuration is verified.

## Release path from current state
1. 07 independently reviews Web PR #117 exact current head after the account/auth UX runtime delta.
2. 02 fixes APP #132 authoritative bindingId enforcement, expectedEvidence enforcement and lease-credential recovery semantics; then emits a new `READY_FOR_INDEPENDENT_REVIEW` only after exact-head Android Worker + CI PASS.
3. 07 performs fresh APP independent review on the new exact head; then execute physical-device smoke.
4. Configure Google Owner OAuth outside source control, run real browser smoke and record `OWNER_OAUTH_SMOKE_PASS` without exposing credentials.
5. Enable GitHub `main` branch protection/ruleset with PR-only mutation and required status checks, then prove full CI on merge/main SHA.
6. Refresh CURRENT_STATE on the final governance head and obtain fresh exact-head 07 repository-scope PASS; global #113 remains blocked until repository policy is actually enforced and independently proven.
7. Only when all applicable release gates are simultaneously PASS may Owner-authorized Web/APP release proceed.

## External / deferred boundaries
- Vercel filesystem is stateless and is never durable Workforce storage.
- Paid provider/billing activation is not authorized by repository implementation alone.
- No provider credentials, Owner credentials, signing secrets or private keys may enter source control, logs or public artifacts.
- If physical install/login/2FA/OAuth or GitHub Settings policy is the only blocker for one path, record it explicitly and continue all other safe remote work.
