# Learn From Failure

Status: ACTIVE (source)
Issue: #899 - Activate Learn-from-Failure Skill
Target: knowledge-system

## Apply when
TigerIQ sees repeated, equivalent failures in durable runtime evidence and can propose a reusable prevention rule/check.

## Rules
- Learn only from durable failure events with real event sequence + timestamp evidence.
- One isolated failure is not enough; candidate threshold is at least two equivalent verified failures.
- Deduplicate by deterministic signature before creating a new candidate.
- Every candidate must include occurrence count, affected component, evidence refs, first/last seen, and proposed prevention.
- Runtime creates only `FAILURE_LEARNING_CANDIDATE` evidence. It never edits repository files or the Skill Registry.
- A candidate never promotes itself. ACTIVE promotion still requires source implementation, tests, independent review, and merge.
- Credential/security/Production/paid/destructive/irreversible-related candidates are proposal-only and explicitly require Owner authorization.
- Never invent provenance, timestamps, hashes, URLs, or evidence references.

## Evidence
- apps/tigeriq-core/failure-learning.mjs
- apps/tigeriq-core/core.mjs
- tests/core-failure-learning.test.ts

## Non-goals
This skill does not authorize policy mutation, credential/security changes, paid actions, Production/runtime release, destructive actions, or APP Chrome/Worker Utility mutation.
