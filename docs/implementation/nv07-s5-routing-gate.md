# NV07 — S5 Core routing gate (source only)
Work: #4783 / #4788. Depends on #4786 (S3) and #4787 (S4). Stacked candidate.
Status: NOT_MERGED / NOT_CORE_WIRED / PC01_CLI_CANARY_NOT_RUN.

## Decision, not dispatch
`apps/shared/nv07-core-routing-gate.mjs` exports pure `nv07CoreRoutingDecision`.
It verifies that the dynamic employee registry resolves NV07 as Google Antigravity, the dynamic command registry maps `7 → NV07`, admin state has reached ACTIVE without retirement/provisioning flags, and PC01 runtime has a recent verified CLI session/heartbeat.

Additionally, the job must have explicit P1–P5 scope, pinned Git SHA and proposal-only action. The lease must match the job ID and resource scope, belong to NV07 and not be expired. The helper returns `ELIGIBLE_NOT_DISPATCHED`, **not** `RUNNING`.

## Why disabled now
Registry #335 currently marks NV07 `ADMIN_ENABLED / PROVISIONING / RUNTIME_NOT_VERIFIED / NOT_YET_ROUTABLE`. This correctly yields `NV07_ADMIN_NOT_ACTIVE`. No PC01 process, lease/heartbeat or Antigravity authentication has been accepted yet.

## End-to-end remaining
- Read actual dynamic command and employee registries from #335/current canonical sources. Historical #548 uses NV07 for ChatGPT Go; that history must not override current NV03 identity.
- Connect this pure helper to existing Core queue and authenticated lease engine in a separate approved protected-source PR. No second scheduler/queue.
- Have trusted PC01 host launch verified `agy` in an isolated directory only after live authorization and logging. The S4 source helper does not launch or authenticate anything.
- Return proposal to an independent GitHub executor. PC01 must not write repository source or run ordinary code builds/tests.
- Demonstrate receipt, failure/timeout, lease cancellation, no double dispatch, and rollback in the S6/S7 live acceptance.

## Safety and rollout
No automatic P0 claim, no App Chrome modification, no OS administrator permissions, no direct main, no new credentials or paid subscriptions without required gate. Core/PC01 protected release requires exact head, required review and legitimate signed authorization under #504.

## Acceptance
- [ ] Source S5 tests green and reviewed/merged.
- [ ] Live Core adapter calls gate, fetches fresh registry, checks authenticated lease, and creates dispatch receipt.
- [ ] Real NV07 CLI canary verifies session and result JSON; then UI status reflects heartbeat.
- [ ] Combined S6 canary passes; only then mark NV07 ACTIVE.

This source candidate alone does not satisfy those checks.
