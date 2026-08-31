# WO-045 — Web Control Remote Operations

## Goal
Turn the primary TigerIQ Web Control into the Owner's single remote operations surface for verified status, work/evidence visibility, safe Work Order dispatch, and bounded PC01 channel checks without asking the Owner to open PowerShell or paste browser credentials.

## Audited baseline — 2026-08-31
- Source branch starts from MAIN `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042).
- Production Vercel is still on older MAIN SHA `69ef75149155c09d4618afef941e54cf02feaf79`; WO-041/042 are not production-released.
- Canonical PC01 canary issue #58 has no CLAIM/RESULT evidence at takeover.
- Canonical PC01 Controller deployment issue #100 has no CLAIM/RESULT evidence at takeover.
- PC01 recovery is owned by #57 and PC01 security hardening is owned by #114; WO-045 must not modify that runtime.
- `docs/CURRENT_STATE.md` reconciliation is owned by independent audit #113 and is intentionally not edited here to avoid scope collision.

## Scope
- Primary `/` Web Control UX.
- Read-only Web status aggregation needed by the UI.
- Owner-authenticated Work Order dispatch through the existing `/api/control` contract.
- Deterministic `system.status` canary through the existing bounded canary operation.
- Lifecycle/evidence visibility: CLAIM, RESULT/FAILED, REVIEW_PASS, JUDGE_PASS.
- Explicit distinction between PC01 execution-channel evidence and unknown physical-device state.

## Non-scope
- No App changes.
- No AI coordinator/model-routing changes.
- No PC01 worker/watchdog/controller runtime changes.
- No Work Management engine changes.
- No independent-review/governance changes.
- No MAIN or Production release in this work order.
- No direct browser-to-shell, arbitrary command execution, credential entry, or secret exposure.

## Acceptance checklist
- [ ] `/` is one unified Web Control page for monitoring and remote operations.
- [ ] Unauthenticated/unconfigured Owner state is read-only and fail-closed.
- [ ] Browser never asks for GitHub token or command secret.
- [ ] Work Order creation uses existing evidence-gated `/api/control` contract.
- [ ] PC01 check uses only the existing deterministic canary operation.
- [ ] PC01 UI does not claim physical online/offline without direct evidence.
- [ ] Recent work shows runtime/review/judge evidence where present.
- [ ] Static regression tests pass.
- [ ] Full repository typecheck/tests/build pass on exact feature SHA.
- [ ] Vercel Preview is READY and API/UI smoke is verified.
- [ ] Production remains unchanged until explicit release authorization.

## Release gate
`WEB_CONTROL_VERIFIED` is not allowed until a bounded Web-created Work Order/command is actually consumed by PC01 and returns terminal evidence through the required review/judge path without Owner terminal interaction. Until PC01 recovery/security and Owner OAuth environment are ready, completion status must be `CHỜ BÊN NGOÀI` or `BLOCKER THẬT`, not 100%.
