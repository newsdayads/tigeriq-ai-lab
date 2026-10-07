# Core Acceptance Verifier

## Identity
- ID: core-acceptance-verifier
- Version: 0.1.0
- State: CANDIDATE
- Target: core-manager
- Provenance: #4457; #4462; #4463; #4503

## Trigger
Use when TigerIQ Core needs to determine whether a bounded P1-P5 task or objective satisfies its declared acceptance criteria using authoritative evidence before terminal completion, release, or further replanning.

Do not use for P0 or for any step gated by credentials, security/permission changes, paid/financial action, destructive/irreversible action, or Production authority.

## Input
- Authoritative task/objective definition with acceptance criteria and required evidence.
- Current source revision, branch/PR/merge state, test/check results, review evidence, runtime verification and durable receipts when applicable.
- Dependency and child terminal state.
- Deterministic policy constraints: owner gates, independent-review separation, one-writer scope, zero-cost/security/Production rules.
- Previous verification result/checkpoint when re-verifying after new evidence.

## Steps
1. Resolve the exact acceptance criteria from the authoritative work item; never invent missing criteria.
2. Map every criterion to concrete evidence and its durable source.
3. Validate evidence freshness against the exact source revision/head/merge/runtime target required by the work item.
4. Reject stale, mismatched, self-asserted, partial, or unverifiable evidence.
5. Require independent review when the work item or canonical policy requires it; executor self-approval is insufficient.
6. Distinguish implementation evidence, repository checks, merge evidence, runtime/LIVE evidence, and owner-gated evidence.
7. Mark each criterion PASS, FAIL, or BLOCKED with the smallest exact reason.
8. Do not infer parent completion from a partial child result; verify required dependencies/children independently.
9. If criteria are incomplete but more safe executable work exists, return the exact next verification/execution step instead of false completion.
10. Submit the verification result to the deterministic governor, which alone decides terminal state/close/release authority.

## Output
A bounded acceptance verification result containing:
- target task/objective and exact source revision;
- criterion-by-criterion PASS/FAIL/BLOCKED;
- evidence references supporting each PASS;
- exact deficiency or unblock condition for FAIL/BLOCKED;
- independent-review status;
- repository/runtime/LIVE verification status when applicable;
- terminal recommendation: COMPLETE, CONTINUE, or BLOCKED.

The output is evidence assessment only; terminal state changes remain deterministic-governor actions.

## Acceptance
- No criterion is marked PASS without matching authoritative evidence.
- Exact-head/exact-revision requirements are enforced when specified.
- Required independent review cannot be replaced by implementer self-review.
- Stale or cross-target evidence is rejected.
- Parent/objective completion is not inferred from partial child completion.
- Hard gates remain BLOCKED rather than silently bypassed.
- Equal authoritative evidence produces deterministic verification results.
- Verifier never directly dispatches, merges, publishes, closes, changes credentials, spends money, changes security boundaries, or performs destructive actions.

## Evidence
- #4457 defines evidence + acceptance verification as a distinct stage before DONE and keeps the deterministic governor as final authority.
- #4462 verifies continuity behavior after terminal evidence and dependency release.
- #4463 verifies PLAN_DELTA/Manager-HA shadow boundaries and deterministic safety validation.
- #4503 defines this reusable acceptance verifier skill as documentation-only candidate material.

## Fallback
If acceptance criteria, source revision, review evidence, checks, merge state, runtime target, or required receipts are incomplete or contradictory, return BLOCKED or CONTINUE with the exact missing evidence. Never fabricate PASS evidence to avoid a stalled queue.

## Safety
The deterministic governor and authoritative evidence sources are final. This skill cannot override owner gates, P0 controls, resource leases, one-writer rules, independent-review separation, zero-cost policy, credential/security boundaries, Production gates, or destructive-action protections.

Codex is not implicitly authorized by this skill. Any Codex use still requires separate explicit Owner approval for the exact bounded scope.

## Non-goals
- Implementing Coding Lane health/latency manager scoring (#4465).
- Implementing shared Core/Coding Lane leases (#4467).
- Acting as implementer, merger, publisher, closer, deployer, or runtime operator.
- Replacing the deterministic governor or canonical source of truth.
- Activating this skill before validation, promotion evidence, reviewed registry mutation and applicable tests.
