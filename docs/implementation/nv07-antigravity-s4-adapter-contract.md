# NV07 Antigravity — S4 headless proposal adapter contract
Date: 2026-10-15. Parent #4783, work item #4787. Status: SOURCE_CANDIDATE / NO_PC01_DEPLOYMENT.

## Scope / topology
Owner/Vy → canonical Core queue/lease → trusted PC01 operator process → Google Antigravity CLI `agy` → structured **proposal** → trusted GitHub executor → PR/CI/review → Core receipt.
On PC01 the assistant **must not modify TigerIQ repository source**. This is a binding from `docs/EXECUTION_BOUNDARY.md`; the GitHub executor independently handles source mutation. Do not install a new scheduler.

## Source-only interface
- `prepareNv07CliProposal(job,{sandboxCwd})`: reuses S3 `nv07ProposalPreflight` to validate employee=NV07, GitHub repo, scoped P1–P5 paths, pinned SHA and read-only/proposal action; produces an immutable `agy` invocation with JSON schema and `--sandbox`. The host is responsible for validating the sandbox directory, permission settings and OS identity.
- `verifyNv07CliProposal({job,invocation,exitCode,stdout,stderr,timedOut})`: requires exit code zero, non-denied stderr, `status=SUCCESS`, matched job id, structured JSON with whitelisted target paths. Returns `PROPOSED_NOT_IMPLEMENTED`, hash and limited token usage, never says code was changed.
- Negative cases: timeout, nonzero process status, missing JSON/schema, `WAITING`, auth errors, permission soft-denials even with exit code zero, out-of-scope proposal paths.
- Pure source helpers do **not** execute any command or verify current Core lease; they cannot grant Windows permissions by themselves.

## Trusted host requirements before running anything
1. Verify real authenticated `wdragons12x` session, original Google CLI provenance/version, entitlement/quota and approved PC01 device/worker identity.
2. Verify atomic lease and idempotency key against Core #280, authenticated assignment, expiration and one writer per resource scope.
3. Set CLI working directory to an isolated disposable NV07 sandbox, NOT the TigerIQ repository, with writable surface restricted. In actual CLI config explicitly deny `command(*)`, `write_file(*)` and other sensitive tools as supported; inspect Windows permission behavior in real canary. `--sandbox` does not by itself prove read-only.
4. Limit process duration and output, capture stdout/stderr separately with redaction and no raw secret forwarding. Abort on auth/cost/permissions/soft-denials.
5. Treat proposed text as untrusted; the separate GitHub executor must independently validate every patch before applying it.

## Acceptance
- [ ] GitHub CI and independent review for source helpers; exact SHA merged after existing gates.
- [ ] A real host adapter enforces OS/session, config deny policy, lease/idempotency and process timeout/cancellation. The present module is not the real host adapter.
- [ ] Canaries: success JSON with proposal, fail/timeout/soft-denial, duplicate lease, no direct PC01 source write, no paid credentials, no App Chrome.
- [ ] Core status reports only measured READY/IDLE/BUSY; UI does not invent ACTIVE.
- [ ] Signed PC01 release event if updater requires it; no bypass via RDC or another account.

## Sources
Official Google CLI headless/JSON https://www.antigravity.google/docs/cli/headless/
Google permission semantics https://www.antigravity.google/docs/permissions?tab=cli
Canonical TigerIQ PC01/GitHub execution boundary `docs/EXECUTION_BOUNDARY.md`.
