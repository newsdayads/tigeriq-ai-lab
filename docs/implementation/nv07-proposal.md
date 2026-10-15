# NV07 protected proposal handoff

Work Order: [#4783](https://github.com/newsdayads/tigeriq-ai-lab/issues/4783).

This planning document implements the one file proposed by the actual NV07 CLI job `NV07-4783-CORE-20261015T175311-001`. The protected user-session runner produced a structured proposal; a separate GitHub executor authored this repository document. NV07 did not edit repository files or run a development build on PC01.

## Provenance

- Pinned input source: `2bf72df2774eee67c19c8db5dbd063ddeef640be`.
- Verified CLI output SHA256: `b473807fa0c8af4d85d09a1a39efd5c223d0de9f068cda649f71d28c13f622b5`.
- Core dispatch: `214863`; atomic reservation: `214864`; durable receipt: `tigeriq_events:NV07_CANARY_RECEIPT:214872`.
- [Live execution and readback evidence](https://github.com/newsdayads/tigeriq-ai-lab/issues/4783#issuecomment-6198713586).

The CLI proposed: “Draft non-executable implementation proposal documentation outlining architecture specifications, core interfaces, and migration guidelines.”

## Architecture

Core owns the canonical job ledger, resource lease, one-shot reservation and durable receipt. The protected SYSTEM client checks the actual named-pipe server PID, Windows owner/session, Task Scheduler instance PID and protected code bytes. The limited interactive broker runs as PC01\\wdragons12x; it accepts only a protected, expiring invocation bound to the real client PID and exact job/SHA. A pinned helper invokes the Google-signed CLI with fixed read-only planning flags, no shell and bounded timeout/output.

The CLI returns an untrusted proposal. Core validates status, job identity, path allowlist and structured JSON before persisting a digest-based receipt. A GitHub executor applies any approved proposal on an isolated branch, with required CI and applicable review gates. App Chrome and credentials are outside this handoff.

## Core interfaces

| Interface | Authority and output |
|---|---|
| Protected session attestation | Native OS peer/process/task/code checks; no caller-supplied identity evidence |
| Protected Owner approval | Exact job, source SHA, action, resource scope and expiry |
| Shared resource lease | Canonical Core transaction, TTL and token-bound heartbeat/release |
| One-shot reservation | Unique durable event per job; replay cannot launch another CLI process |
| Proposal verifier | Strict success envelope and allowed repository paths; never asserts implementation |
| Durable receipt | Existing Core event ledger tied to the reservation and active exact lease |
| GitHub executor | Branch, proposed artifact, required checks, review/waiver and merge evidence |

## Migration and acceptance

1. Preserve the accepted V3 transport receipt; do not rerun it.
2. Accept the protected native session and Core lease/receipt path using actual PC01 execution evidence.
3. Connect the bounded canary to the existing Core queue and command 7; accept S5b from a real queued job.
4. Verify this GitHub artifact and required checks against its exact head; record the applied proposal linkage in Core before accepting S6.
5. Verify controlled release, rollback, loss-of-host denial and fresh heartbeat before accepting S7 or advertising ACTIVE.

The present document does not grant execution permissions, activate NV07 or assert that S5b–S7 have passed. Current acceptance remains in Work Order #4783.

## Risks

Source content and model output remain untrusted. Configuration drift must be checked against the pinned source. Code changes, tests and PR creation must be proven by the GitHub executor and CI rather than inferred from the CLI summary. Only trusted runtime and Core receipts may establish live readiness.
