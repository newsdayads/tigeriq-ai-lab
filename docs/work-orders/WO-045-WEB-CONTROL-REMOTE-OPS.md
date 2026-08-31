# WO-045 — Web Control Remote Operations

## Goal
Turn the primary TigerIQ Web Control into the Owner's single remote operations surface for verified status, work/evidence visibility, safe Work Order dispatch, and bounded PC01 channel checks without asking the Owner to open PowerShell or paste browser credentials.

## Audited baseline — 2026-08-31
- Source branch starts from MAIN `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042).
- Production Vercel is still on older MAIN SHA `69ef75149155c09d4618afef941e54cf02feaf79`; WO-041/042 are not production-released.
- Canonical PC01 canary issue #58 has no CLAIM/RESULT evidence at takeover and still has none at the latest Web Control audit.
- Canonical PC01 Controller deployment issue #100 has no CLAIM/RESULT evidence at takeover and still has none at the latest Web Control audit.
- PC01 recovery is owned by #57 and PC01 security hardening is owned by #114; WO-045 must not modify that runtime.
- `docs/CURRENT_STATE.md` reconciliation is owned by independent audit #113 and is intentionally not edited here to avoid scope collision.
- Vercel Hobby deployment quota is exhausted (`api-deployments-free-per-day`), so Preview availability is an external capacity condition, not a code-quality signal.

## Scope
- Primary `/` Web Control UX.
- Read-only Web status aggregation needed by the UI.
- Owner-authenticated Work Order dispatch through the existing `/api/control` contract.
- Deterministic `system.status` canary through the existing bounded canary operation.
- Lifecycle/evidence visibility: CLAIM, RESULT/FAILED, REVIEW_PASS, JUDGE_PASS.
- Explicit distinction between PC01 execution-channel evidence and unknown physical-device state.
- A non-Vercel contract E2E gate that executes the real Web Control handlers against a simulated GitHub transport to verify the exact cross-component protocol.

## Non-scope
- No App changes.
- No AI coordinator/model-routing changes.
- No PC01 worker/watchdog/controller runtime changes.
- No Work Management engine changes.
- No independent-review/governance changes.
- No MAIN or Production release in this work order.
- No direct browser-to-shell, arbitrary command execution, credential entry, or secret exposure.

## Acceptance checklist
- [x] `/` is one unified Web Control page for monitoring and remote operations.
- [x] Unauthenticated/unconfigured Owner state is read-only and fail-closed.
- [x] Browser never asks for GitHub token or command secret.
- [x] Work Order creation uses existing evidence-gated `/api/control` contract.
- [x] PC01 check uses only the existing deterministic canary operation.
- [x] PC01 UI does not claim physical online/offline without direct evidence.
- [x] Recent work shows runtime/review/judge evidence where present.
- [x] Static regression tests pass.
- [x] Full repository typecheck/tests/Playwright/build pass on exact Web Control head.
- [x] Non-Vercel contract E2E proves `Web Control dispatch -> queue contract -> CLAIM -> RESULT -> REVIEW/JUDGE -> Web status evidence` using the real API handlers.
- [ ] Owner OAuth is runtime-smoked with real configured provider/environment.
- [ ] Real PC01 consumes one bounded Web-created operation and returns terminal evidence through the required review/judge path.
- [ ] Independent Web Control review/gate passes on the exact head.
- [x] Production remains unchanged until explicit release authorization.

## Preview fallback policy
Vercel Preview is useful but is not a mandatory P0 blocker when provider quota prevents deployment. Code/interface acceptance may proceed using the exact-head CI contract E2E plus repository gates. This fallback does **not** replace the real PC01 runtime gate, Owner-auth runtime smoke, independent review, or explicit Production release authorization.

## Release gate
`WEB_CONTROL_VERIFIED` is not allowed until a bounded Web-created Work Order/command is actually consumed by PC01 and returns terminal evidence through the required review/judge path without Owner terminal interaction. Until PC01 recovery/security, Owner-auth runtime, and independent review are ready, completion status must be `CHỜ BÊN NGOÀI` or `BLOCKER THẬT`, not 100%.
