# WO-026 — Durable Android Task Lease Protocol

Status: DONE — REMOTE SOFTWARE/CI VERIFIED

## Delivered
- Durable task mailbox for Android/remote workers.
- Bounded attempts and expiring lease token/deadline.
- Raw lease token is not persisted.
- Restart recovery requeues expired in-flight work only while attempts remain.
- Stale/expired lease results are rejected.
- Accepted completion is idempotent and single-result authoritative.

## Verified evidence
- PR: #85.
- Exact head: `09aeb3fc5b83ed04a09aad9bffa96efadccb6bdc`.
- CI: run `33327547847` PASS.
- Queue Hygiene: run `33327547862` PASS.
- Vercel Verify: run `33327547868` PASS.
- Preview: `dpl_D9VZ4wMRDjgEBCFLfgd14mYuXDxx` READY at exact head.
- Merge SHA: `6c7b8510016f860db7631e481ca5ce87a72b109f`.
- Production deployment: `dpl_FmiZLAVobDUruH7ehn7vNAmhvmgN` READY at merge SHA.

## Non-claims
No physical phone, PC01 runtime, provider credential, billing action or consumer-app automation was activated by this Work Order.
