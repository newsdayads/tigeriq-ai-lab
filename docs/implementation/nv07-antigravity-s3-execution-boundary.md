# NV07 — Antigravity execution boundary and proposal preflight (S3)

**Work:** #4783 / #4786. **Source authority:** Issue #335 v57, Issues #280 and #504, and `docs/EXECUTION_BOUNDARY.md` (GitHub `main`).
**Status:** source-only candidate; no deployed adapter or live authorization.

## Non-negotiable separation

- **Owner → Vy → Core** retains job ownership, authorization, queue, lease, review and P0 authority.
- **PC01** can host the verified Google Antigravity CLI under the authorized interactive Windows user; it can read approved metadata, generate a bounded structured proposal and return JSON/receipts. PC01 is **not** the source-editing, Git worktree, ordinary code test/build, commit or PR lane.
- **GitHub executor** is a separately authorized engineering worker that receives the proposal, validates it against its own source policy, implements on a separate branch through GitHub, runs CI and submits a PR. The proposal is untrusted data, never a command to execute blindly.
- **Reviewer/CI** must be independent when required. A passing LLM response does not mean the GitHub artifact exists.
- **App Chrome** stays LOCAL-only Owner/Vy. NV07 cannot change or self-heal App Chrome source/runtime.

## Scope contract

`apps/shared/nv07-proposal-preflight.mjs` exports `nv07ProposalPreflight(task)` as a **static fail-closed preflight** for planned adapter use. It does not grant identity, OS access, process execution, GitHub permissions, lease ownership or P0 authority. Those must be checked again in their authoritative hosts.

Fields checked: `employeeId=NV07`, `executionHost=PC01`, `repository=newsdayads/tigeriq-ai-lab`, `priority=P1..P5`, `action=READ_METADATA|PROPOSE_CHANGE`, `jobId`, exact forty-character `sourceSha`, and bounded repo-relative `paths`.

Default-deny gates: wrong repo (particularly `newsdayads/drivetrack`), P0, source file mutations/build/test/commit/push from PC01, direct main, unknown action, protected Core/Control Plane paths, App Chrome, secret/credential paths, absolute/traversal paths, requests for paid/credential/security/production/destructive/OS administrator scope and CLI bypass flags.

Return: `DENY` with a code, or `PROPOSAL_ONLY` with the canonical selected paths and pinned source SHA. The adapter must still verify **authenticated real user**, valid owner/lease, capability and signed release gates in its own layer before running the CLI.

## Google CLI and resource governance

- Official headless API uses `agy -p <prompt> --output-format json` and emits `status`, `response`, optional `error` and `usage`. Inspect those plus actual artifact and redacted stderr; exit code alone is insufficient. Reference: https://antigravity.google/docs/cli/headless/.
- Google uses the authenticated account's quota; check entitlement and terms for local orchestration. No extraction/reuse of cached OAuth tokens, no custom Antigravity backend calls, no headless high-frequency polling.
- PC01 install still requires provenance/hash and legitimate user-session login. RDC `SYSTEM` authentication is not equivalent to `wdragons12x` interactive authentication.
- Do not install or invoke unsigned/unknown binaries, download-and-execute scripts blindly, use `--dangerously-skip-permissions`, or alter antivirus/firewall/Windows ACL to make automation work.

## Example handoff

1. Core accepts P2 job `GH-4786:S3` with approved source SHA and path `docs/implementation/nv07-example.md`; validates atomic resource lease.
2. Local adapter validates preflight and calls CLI only to **propose** a minimal change. No shell or code-editing tools are allowed.
3. Adapter stores a redacted receipt, hash and structured proposal. Do not count free-text claims as changes.
4. Core routes the proposal to authorized GitHub worker; that worker rechecks job scope, independently assesses prompt-injection risk, creates branch/PR and relies on GitHub CI.
5. Reviewer signs off if policy requires. Core records actual PR/CI outcome; UI only shows NV07 ACTIVE after authenticated PC01 canary and current heartbeat.

## Acceptance checklist for S3

- [ ] PR with this contract and test has passed CI and independent review.
- [ ] Static preflight proves all negative cases plus pinned in-scope proposal; repository mutation from PC01 denied.
- [ ] Source PR merged to `main` after exact-head gates.
- [ ] Adapter in S4 consumes this preflight; a policy file that is not enforced is not a live security guarantee.

These S3 checks do not replace S2 (PC01/user authentication), S4 (real adapter), S5 (Core routing), S6 (E2E), or S7 (signed deployment/rollback).
