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

## Current release candidate evidence — 2026-08-31
Exact branch head: `0f2f0d4f296ec0582451f6238840a45755481e14`.

Latest runtime-changing UI/Auth commit: `952da55c7fc2c584433c39cb74bfe1782d8292be`.
READY Vercel Preview for that runtime commit: `dpl_FrjAbGboNV4FMUG7RcGGtLciHMxV`.
Branch alias: `https://tigeriq-ai-lab-git-wo045-web-control-remote-ops-nguyn-trng-sn.vercel.app`.

Compare `952da55c...` -> `0f2f0d4f...` changes only:
- `tests/web-control-account-auth.test.mjs`
- `tests/web-control-remote-ops.test.mjs`

Therefore the READY Preview is runtime-equivalent to the exact branch head.

Exact-head automated gates:
- CI #274 / run `33383717396`: PASS.
- Queue Hygiene #189 / run `33383717406`: PASS.
- WO-012/013 Vercel Online Verify #163 / run `33383717415`: PASS.

Executable tests prove:
- unauthenticated account has no assigned TigerIQ role and remains fail-closed;
- Google name/avatar are identity only;
- TigerIQ independently assigns current Owner role;
- requested Admin/Nhân viên/Chỉ xem vocabulary is not treated as implemented authorization;
- account/login/floating-refresh/workforce-module UI contract;
- previous security, dedupe and evidence gates remain intact.

## Preview evidence boundary
Deployment `dpl_FrjAbGboNV4FMUG7RcGGtLciHMxV` is READY and tied to the exact UI runtime commit `952da55c...`. Vercel Preview Protection currently redirects unauthenticated machine fetches through Vercel SSO, so this stream does not falsely claim a completed external browser/OAuth smoke from machine fetch alone.

## Remaining gates
- Fresh independent 07 review on exact head `0f2f0d4f296ec0582451f6238840a45755481e14` after this UI/Auth change.
- Real configured Google Owner OAuth browser smoke, recorded as `OWNER_OAUTH_SMOKE_PASS`.
- Explicit Owner publish/release instruction.

PC01 remains deferred and is not a blocker for this Web-only gate. MAIN/Production remain unchanged.