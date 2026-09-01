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
- MAIN is still reported `protected:false`; repository rulesets remain absent. This is the canonical P0 governance defect tracked by #113.

## Governance enforcement work — #113 / PR #118
PR #118 (`wo046/current-state-governance-reconcile`) is the governance implementation branch.

Implemented on the branch:
- `.github/workflows/ci.yml` includes `push` to `main` and `merge_group`, so after merge it can provide full post-merge/main-SHA CI evidence and support merge-queue exact-merge verification.
- `.github/workflows/governance-independent-review.yml` adds a machine-verifiable independent-review status gate for non-draft PRs.
- `scripts/verify-independent-review-gate.mjs` requires a structured exact-head PASS marker containing `TIGERIQ_INDEPENDENT_REVIEW_PASS`, `REVIEW_ROLE: 07`, exact HEAD SHA and typed `EVIDENCE_REF`.
- `docs/governance/MAIN_PROTECTION_V1.md` defines the required `main` protection/ruleset policy and the one-time bootstrap behavior for the first governance PR.

Bootstrap evidence already proven on prior exact head `71329b3321d9b736a9bbb3c16e7c65507486cad2`:
- 07 submitted structured exact-head review PASS (`TIGERIQ_INDEPENDENT_REVIEW_PASS`).
- CI #320, Queue Hygiene #207 and Vercel Verify #181 were PASS.
- `Governance Independent Review Gate` run #7 / `33455971386` was re-run after the review and completed PASS on attempt 2; job `independent-review` verified the exact-head review evidence successfully.
- This proves the verifier/gate logic can be bootstrapped without bypassing review. It does NOT make global #113 PASS and does NOT authorize MAIN/Production.

Still external / not yet enforced:
- GitHub repository policy must protect `main` via branch protection or ruleset and make PR-only mutation mandatory.
- Required checks must include full `CI / verify`, `Governance Independent Review Gate / independent-review`, and `WO-014 Queue Hygiene / verify` (plus any additional release checks selected by 07/Owner).
- The new `pull_request_review` trigger becomes normal default-branch behavior only after the governance workflow itself lands on `main`; until then the bootstrap procedure requires exact-head 07 review plus successful re-run of the same exact-head gate.
- Any commit after a PASS supersedes that PASS and requires fresh exact-head 07 review/gate evidence.
- Until repository policy is actually enabled and independently re-audited, #113 remains FAIL and MAIN/Production release stays fail-closed.

## Web Control — PR #117
- Canonical branch: `wo045/web-control-remote-ops`.
- Current exact head observed: `1324830e8737f3395e51fa33107f9cce81aac708`.
- Exact-head Preview: `dpl_x3Q7HLNiV9Kj1JB6m3zHsSzzA6Tf` on the stable branch alias.
- UI uses primary brand `TigerIQ AI`; `Web Control` is a module/subtitle.
- Top-right account UX is app-style; signed-in view shows Google avatar/name/email plus TigerIQ role; logout is supported; floating refresh remains below the account region on mobile.
- Google Identity Services is identity-only. TigerIQ validates the Google ID token server-side and assigns application authorization; current implemented role is Owner only.
- Current configuration contract uses `TIGERIQ_OWNER_EMAIL`, `TIGERIQ_OWNER_GOOGLE_CLIENT_ID`, and `TIGERIQ_OWNER_SESSION_SECRET`; Google Client Secret/code-flow redirect are retired for the current GIS flow.
- Exact-head repository gates: CI #341 / `33466167298` PASS; Queue Hygiene #217 / `33466167322` PASS; Vercel Verify #191 / `33466167309` PASS.
- Real Owner browser smoke is PASS: `OWNER_OAUTH_SMOKE_PASS` review ID `5073768562` on this exact head/runtime.
- Fresh 07 independent review after the GIS migration is PASS on this exact head/runtime.
- The same Web UI truthfully reports that the server-side GitHub write credential is not configured, so mutation controls remain fail-closed. This is an operational write-readiness item, not an auth failure.
- Owner publication intent is recorded, but release remains blocked by global governance #113 until accepted.

## Work Management / AI Gateway / shared Android v0.7 contract
- PR #126 (`wo047/android-worker-core-v07`) is the frozen Employee/Device/Job Core contract branch at exact `7bbaec2e503f579f876d6af96c59911d3a618b84`.
- PR #127 (`wo047/api-first-inference-gateway`) is the frozen server-side inference Gateway branch at exact `6c8d006054c04330d353a61acacc7107d53bf4e7`.
- Gate #130 / PR #131 provides the cross-stream integration proof and emitted canonical `CONTRACT_V07_READY`; APP implementation is therefore unlocked.
- These components do not authorize MAIN/Production release by themselves.

## Android APP v0.7 — PR #132
- Canonical branch: `wo048/android-v07-api-first-worker` stacked on the phone-first Android baseline.
- Current exact head observed: `a5a10c9e6d5039ef38577727e077c5ca82d26bf8`.
- 02 emitted a fresh `READY_FOR_INDEPENDENT_REVIEW` after remediating the authoritative review blockers.
- Remediated on this head:
  1. authoritative `bindingId` is persisted and bound to enrolled Employee/Device/key fingerprint; changed/stale binding fails closed across lease/result/submit;
  2. authoritative Job `expectedEvidence` is enforced before `status:"completed"`; unmet/wrong evidence fails closed;
  3. raw lease authority is process-memory-only and is no longer durably persisted; durable checkpoint retains only non-secret lease identity/hash/expiry and recovery reacquires authority after process/reboot loss.
- Exact-head gates: CI #331 / `33460742327` PASS; Android Worker #81 / `33460742290` PASS.
- Fresh 07 independent review is `APP_V07_INDEPENDENT_REVIEW_PASS` on exact head `a5a10c9...`.
- Repository/software gate is therefore PASS. Physical-device enrollment/Keystore hardware behavior, reboot/network smoke, stable-signed install/update continuity and real end-to-end execution remain required before APP release.
- No provider API key, GitHub PAT or Owner credential may be embedded in APK/source/resources/logs/evidence. v0.7 execution must not use Accessibility as the AI execution engine.

## Work Management parent
- PR #115 remains the parent Work Management stream. Its exact head `97641f6895e829aa72f252fdfd03d7b4dc8e6364` has `WO044_INDEPENDENT_REVIEW_PASS` with exact-head CI/Queue/Vercel evidence.
- Do not create a duplicate Work Management implementation stream.

## Canonical PC01 / device truth
- PC01 is currently deferred by Owner instruction and is not a blocker for current Web/API-first Android work.
- Issue #100 remains the canonical physical Workforce Controller deployment job; historical lack of CLAIM/RESULT must not be converted into a runtime PASS.
- Issue #58 remains the canonical deterministic PC01 autonomy canary; issue #57 remains the canonical PC01 recovery work order. Do not create duplicate PC01 recovery/canary streams.
- Repository/CI evidence is never PC01/Tailscale runtime evidence. Never infer a live listener, heartbeat, pairing or durable PC01 state without direct runtime evidence.

## Verified historical Workforce software baseline
WO-024 through WO-030 established durable Workforce contracts and Controller/Worker foundations: organization hierarchy, node registry/capability scheduling, Task Packet/Result/Evidence contracts, concurrency/idempotency/bounded retries/lease recovery, PC01 FileJournal durability/hash-chain evidence, scoped credentials, P-256 pairing proof, private Controller API, Android Worker identity/runtime/secure-store foundations, Farm Gateway adapter boundary, and simulator/CI proof of parallel workers plus independent Reviewer/Judge behavior.

WO-031 added the executive Workforce/Company Command Center. WO-032 added the Z Flip 7 pilot employee UI/profile and buildable Android artifact. WO-034 added trusted Controller pairing, tailnet-scoped Controller URL policy, employee self-enrollment and authenticated heartbeat. WO-035 made the Command Center the preferred installed-PWA entry.

WO-036 through WO-042 are repository/software milestones only unless separately backed by physical/runtime/Production evidence.

## Release path from current state
1. Keep Web PR #117 frozen on exact head `1324830e...`: Owner OAuth smoke PASS + fresh 07 Web PASS are already satisfied.
2. Configure the server-side GitHub write credential outside source control so authenticated Owner Web Control can create/update Work Orders; verify with one harmless canary before normal use.
3. Keep APP PR #132 frozen on exact head `a5a10c9...`: repository/software 07 PASS is satisfied; run physical-device smoke before APP release.
4. Complete governance #113: enable `main` branch protection/ruleset with PR-only mutation and required checks.
5. Refresh CURRENT_STATE on the final governance head; obtain fresh exact-head 07 repository-scope PASS and a successful Governance Independent Review Gate on that same exact head.
6. After governance workflow lands on `main`, verify full CI on the resulting main/merge SHA and verify the `pull_request_review` gate activates normally from default-branch workflow state.
7. Only when all applicable release gates are simultaneously PASS may Owner-authorized Web/APP release proceed.

## External / deferred boundaries
- Vercel filesystem is stateless and is never durable Workforce storage.
- Paid provider/billing activation is not authorized by repository implementation alone.
- No provider credentials, Owner credentials, signing secrets or private keys may enter source control, logs or public artifacts.
- If physical install/login/2FA or GitHub Settings policy is the only blocker for one path, record it explicitly and continue all other safe remote work.
