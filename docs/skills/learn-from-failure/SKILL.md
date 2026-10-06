# Learn From Failure

## Identity
- ID: learn-from-failure
- Version: 1.0.0
- State: ACTIVE
- Target: knowledge-system
- Provenance: registry.yaml; #899

## Trigger
Use when TigerIQ sees repeated equivalent failures in durable runtime evidence and can propose a reusable prevention rule/check.

## Input
- Durable failure events with real sequence/timestamp evidence.
- Affected component/resource and failure signature.
- Existing learning candidates for dedupe.

## Steps
1. Require at least two equivalent verified failures.
2. Build a deterministic failure signature.
3. Deduplicate against existing candidates.
4. Record occurrence count, component, evidence refs, first/last seen, and proposed prevention.
5. Emit a candidate only; promotion remains a separate evidence-gated path.

## Tools / Output
Use the current failure-learning runtime. Output durable `FAILURE_LEARNING_CANDIDATE` evidence; never mutate the repository or Skill Registry directly.

## Acceptance
- One isolated failure never creates a learned rule.
- Equivalent candidates are deduplicated.
- Every candidate contains occurrence count, affected component, evidence refs, first/last seen, and proposed prevention.

## Evidence
- apps/tigeriq-core/failure-learning.mjs
- apps/tigeriq-core/core.mjs
- tests/core-failure-learning.test.ts

## Fallback
If evidence is insufficient or non-equivalent, do not create a candidate; retain the raw failure evidence only.

## Safety
Credential/security/Production/paid/destructive/irreversible-related candidates are proposal-only and require Owner authorization. Never invent provenance, timestamps, hashes, URLs, or evidence references.

## Non-goals
This skill does not self-promote rules, mutate policy, alter credentials/security, spend money, release Production, or perform destructive actions.
