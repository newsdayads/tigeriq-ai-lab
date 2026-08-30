# WO-025 — Workforce Controller Phase 1

Priority: P0
Status: DONE — REMOTE CONTROLLER VERIFIED
Date: 2026-08-30

## Goal
Turn the WO-024 remote domain core into a zero-cost, restart-safe operational controller suitable for PC01/Farm Controller, while keeping Vercel as stateless remote Web Control. Prepare the control path required for physical Android employees without claiming real-device execution before evidence exists.

## Architecture decision
- PC01/Farm Controller is the durable operational authority for workforce state.
- Reuse the existing `FileJournal`: append-only JSONL, flush-to-disk, file lock, per-stream optimistic concurrency and global SHA-256 hash chain.
- Workforce snapshots/checkpoints use a dedicated journal stream. Node credentials use separate streams in the same journal.
- Raw node bearer tokens are returned once at pairing and never persisted; only SHA-256 token hashes are written to disk.
- Vercel filesystem is never treated as durable state.
- Controller binds only to loopback or an explicit private/Tailscale address; wildcard public bind is forbidden.

## Verified implementation
1. `FileJournalWorkforceStateStore` for durable snapshot/checkpoint persistence and restart restore.
2. Durable scoped node credential store with issue/authenticate/revoke and token-hash-only persistence.
3. Android-compatible pairing proof verifier using EC P-256 / SHA256withECDSA over one-time pairing challenges.
4. Private Workforce Controller HTTP API:
   - `GET /api/workforce/status` — sanitized read-only workforce projection.
   - `POST /api/admin/pairing-challenge` — admin-secret protected, short-lived one-time challenge.
   - `POST /api/node/pair` — device key proof, node registration, scoped credential return.
   - `POST /api/admin/employees` — admin-secret protected employee/node binding and role provisioning.
   - `POST /api/node/heartbeat` — credential-scoped node health update.
5. Standalone PC01 runtime using `F:\TigerIQ\State\workforce.jsonl` by default and environment-configurable private host/port/admin secret.
6. Integration tests for file-backed restart dedupe, hash-chained journal state, real P-256 signature verification, credential survival/revocation, private bind, pairing, heartbeat, employee provisioning and status projection.

## Security boundaries
- No AI/Gmail/password/provider credential enters source or workforce evidence.
- Pairing challenge creation and employee provisioning require an admin secret.
- Phone credentials are scoped only to register/heartbeat/task-read/task-result capabilities.
- A phone cannot self-assign department, role or elevated authority.
- Real Android provider-app automation remains out of scope until provider-specific policy and device tests pass.

## Gate evidence
- Final branch head: `d1c494c8ff5fc02325172548f6cc963ee714b80f`.
- PR #83 exact-head CI `33324718822`: PASS.
- PR #83 exact-head Queue Hygiene `33324718851`: PASS.
- PR #83 exact-head Vercel Verify `33324718850`: PASS.
- PR #83 merged to MAIN as `7e2a437f95f814bdd9a2de6a2287fce3a0e217fd`.
- Production deployment `dpl_6pVY9C3P2hqqB9y1Uq62wq3PVdQE`: READY and aligned to merge SHA.
- Canonical Production `/api/control`: HTTP 200 after deploy; existing Web Control capabilities preserved; queue remained exactly #57/#58.
- No Tiger IQ Driver mutation, no live PC01 mutation, no provider/billing activation and no physical-phone execution claim.

## Next active phase
- Durable remote task mailbox/lease/result protocol between Controller and Android workers.
- Buildable TigerIQ Worker Android APK: Keystore identity, pairing, encrypted local credential storage, foreground heartbeat, task inbox/result protocol, AccessibilityService bridge and watchdog.
- Mobile Workforce Board in Web Control.
- Farm Gateway ADB/Appium/UiAutomator2 adapter.
- Two-phone physical acceptance gate.
