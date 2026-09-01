# WO-045 — TigerIQ AI Web Control Remote Operations

## Goal
Make `TigerIQ AI` the primary product identity and keep `Web Control` as an internal operating module for verified status, safe work dispatch, evidence visibility, account identity and bounded remote controls.

## Scope
- Primary `/` Web Control UX under the TigerIQ AI brand.
- Owner Google OAuth identity for the current allowlisted Owner.
- TigerIQ-owned authorization projection; Google does not grant application roles.
- Safe GitHub-backed Work Order dispatch, canonical canary reuse and evidence-gated lifecycle truth.
- Mobile-friendly account and refresh controls.
- `Nhân sự AI` presented as an internal module, not a top-right global shortcut.

## Non-scope
- No MAIN or Production release.
- No PC01 worker/runtime change.
- No App or AI Coordinator implementation.
- No invented multi-role RBAC backend. Current real authorization contract implements only the Owner allowlist.

## Account / authorization contract
Google OAuth is an identity provider only. The signed TigerIQ session carries safe identity fields (`email`, `name`, optional HTTPS `picture`). Authorization remains a TigerIQ decision.

Current implemented authorization:
- authority: `TigerIQ`
- implemented roles: `Owner`
- current Owner is determined by the existing TigerIQ Owner email allowlist
- unauthenticated sessions receive no assigned role and remain fail-closed/read-only

Requested future role vocabulary:
- `Owner`
- `Admin`
- `Nhân viên`
- `Chỉ xem`

The extended role provider is intentionally not fabricated in WO-045. Required integration interface from 06 Work Management is recorded as `06-work-management-rbac-required`.

## UI contract
- Main brand: `TigerIQ AI`.
- Subtitle/module: `Web Control`.
- Header account region always shows an `Đăng nhập` action while unauthenticated.
- If OAuth is not configured, the action remains visible but cannot start OAuth; UI shows configuration warning and all write actions remain disabled.
- After authentication, account region shows Google-provided avatar/name and TigerIQ-provided effective role.
- UI explicitly states: `Google xác thực danh tính · TigerIQ cấp quyền`.
- Refresh is a floating right-side control below the account region for mobile usability.
- `Nhân sự AI` is inside `Module · Nhân sự AI & thiết bị`.

## Security / correctness gates retained
- Browser GitHub token cannot authorize writes.
- Browser-origin internal secret cannot bypass Owner authentication.
- Server-side GitHub credential is required in addition to Owner session for browser writes.
- OAuth callback preserves both session and state-clear cookies.
- Work Order dedupe uses a GitHub repository-shared distributed lock.
- Canonical canary does not create duplicate issues.
- Completion requires bound typed `EVIDENCE_REF` through RESULT -> trusted REVIEW_PASS -> trusted JUDGE_PASS.
- Issue closure alone is never DONE.

## Verified implementation evidence — 2026-08-31
Latest runtime-changing UI/Auth commit: `952da55c7fc2c584433c39cb74bfe1782d8292be`.
READY Vercel Preview for that runtime commit: `dpl_FrjAbGboNV4FMUG7RcGGtLciHMxV`.
Branch alias: `https://tigeriq-ai-lab-git-wo045-web-control-remote-ops-nguyn-trng-sn.vercel.app`.

Implementation/test head `0f2f0d4f296ec0582451f6238840a45755481e14` passed:
- CI #274 / run `33383717396`.
- Queue Hygiene #189 / run `33383717406`.
- WO-012/013 Vercel Online Verify #163 / run `33383717415`.

Compare runtime `952da55c...` -> implementation/test head `0f2f0d4f...` changes only:
- `tests/web-control-account-auth.test.mjs`
- `tests/web-control-remote-ops.test.mjs`

Executable tests prove:
- unauthenticated account has no assigned TigerIQ role and remains fail-closed;
- Google name/avatar are identity only;
- TigerIQ independently assigns current Owner role;
- requested Admin/Nhân viên/Chỉ xem vocabulary is not treated as implemented authorization;
- account/login/floating-refresh/workforce-module UI contract;
- previous security, dedupe and evidence gates remain intact.

The exact current PR head is intentionally not embedded in this file because updating a tracked evidence file creates a new commit. PR #117 body and the 07 handoff are the authoritative exact-head pointers and must be refreshed without source commits.

## Preview evidence boundary
Deployment `dpl_FrjAbGboNV4FMUG7RcGGtLciHMxV` is READY and tied to UI runtime commit `952da55c...`. Vercel Preview Protection redirects unauthenticated machine fetches through Vercel SSO, so this stream does not falsely claim a completed external browser/OAuth smoke from machine fetch alone.

2026-09-01: Preview environment variables for Owner OAuth were configured in Vercel; this documentation-only commit intentionally triggers a fresh Preview build from the current branch tree. No runtime source, MAIN, or Production mutation is introduced by this note.

2026-09-01: Owner replaced the Google OAuth Client ID and Client Secret pair in Vercel Preview after token exchange failure; this documentation-only update triggers another fresh Preview build so the new credential pair is loaded. No credential value is stored in GitHub and no runtime source, MAIN, or Production mutation is introduced by this note.

## P0 Single Door runtime evidence — 2026-09-01
The current PR contains the bounded serverless Single Door path required for `WEB_CONTROL_SINGLE_DOOR_E2E_PASS`:
- one canonical GitHub-backed Work Order with distributed fingerprint dedupe across open and closed states;
- Vercel serverless cloud executor that does not require PC01;
- concrete `TIGERIQ_JOB_RESULT`, `EVIDENCE_REF`, Expected Evidence and Evidence Summary;
- independent Reviewer and Judge model calls;
- HMAC-attested server review/judge gates;
- Web Control work projection exposes the concrete result and evidence instead of badges only;
- legacy `/api/control-legacy` external routing is forced back through `/api/control` so it cannot bypass Single Door.

A temporary Preview-build diagnostic isolated the previous Vercel AI Gateway failure and was removed after evidence capture. It proved Vercel OIDC worked, but inference was blocked by `customer_verification_required` because Vercel required a payment card on file. Under TigerIQ's free/low-cost-first and Owner-controlled-finance rules, that billing-gated route is no longer the default P0 dependency.

### No-card cloud workforce path
The branch now defaults the bounded cloud workforce to the Groq API when `GROQ_API_KEY` is present and does **not** automatically fall back to Vercel OIDC. Vercel AI Gateway remains available only when explicitly selected/keyed.

Default no-card role split:
- Executor: `openai/gpt-oss-120b`
- Reviewer: `qwen/qwen3.8-27b`
- Judge: `openai/gpt-oss-20b`

Official Groq documentation currently exposes a `Free Plan` with per-model limits, while a payment method is required when upgrading from Free to the paid Developer tier. The API is OpenAI-compatible at `https://api.groq.com/openai/v1/chat/completions`, so no new runtime package dependency is required.

Automated branch evidence for the no-card provider change:
- unit/integration tests exercise exactly three Groq calls for Executor -> Reviewer -> Judge;
- tests assert three distinct default role models;
- tests assert the Groq endpoint and `GROQ_API_KEY` bearer credential path;
- tests preserve the explicit Vercel AI Gateway compatibility path;
- existing HMAC gate tamper rejection remains intact.

A second fail-closed prerequisite remains for actual browser dispatch: the server-side GitHub write credential is not configured in the Vercel Preview environment. Browser PAT/internal-secret bypass remains rejected by design.

## Remaining P0 gates
1. Create one Groq Free-tier API key; do not upgrade to Developer and do not add a payment method.
2. Configure only `GROQ_API_KEY` in Vercel Preview and redeploy the branch.
3. Run a minimal cloud canary and require real Executor -> Reviewer -> Judge PASS.
4. Configure the minimum-scope server GitHub write credential for `newsdayads/tigeriq-ai-lab` (`Issues: Read/Write`, `Metadata: Read`) in Vercel Preview.
5. Run the real Owner Web Control flow: Google sign-in -> submit one harmless goal -> exactly one canonical Work Order -> executor result/evidence -> reviewer -> judge -> Web Control result/evidence projection.
6. Verify duplicate submission reuses the same canonical Work Order.
7. Fresh independent 07 review must target the final exact runtime/head after the P0 canary.

02 APP remains paused. Governance #113 remains recorded but must not occupy the P0 critical path before Single Door usability. MAIN/Production remain unchanged.

## Remaining release gates
- Fresh independent 07 review on the exact PR #117 head/runtime after P0 Single Door canary.
- `WEB_CONTROL_SINGLE_DOOR_E2E_PASS`.
- Explicit Owner publish/release instruction if a MAIN/Production release is later requested.

PC01 remains deferred and is not a blocker for this Web-only gate. MAIN/Production remain unchanged.
