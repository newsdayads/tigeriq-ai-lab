# Skill Effectiveness Evidence — 2026-09-27

Parent work: #1566
Promotion PR: #2195
Promotion review: #2196
Batch: owner-agent-review-document-research-2026-09-23

## Scope

This document records durable USE/MEASURE evidence for the two skills promoted to ACTIVE from the 2026-09-23 batch.

It does not claim complete runtime telemetry. The current effectiveness helper described in `docs/skills/effectiveness/README.md` is in-memory only, so historical executions cannot be reconstructed into an authoritative lifetime success rate.

## isolated-parallel-execution

### Observed USE
- Phase 2 used an isolated feature branch `learning/issue-1566-validate-20260927`, changed only `docs/skills/**`, passed exact-head checks, received independent review, and merged through PR #2193.
- Phase 3 used a separate isolated feature branch `learning/issue-1566-promote-20260927`, changed only `docs/skills/**`, passed exact-head checks, received independent review, and merged through PR #2195.
- In both phases, mutation ownership was explicitly released before independent review.

### MEASURE
Observed bounded workflow samples: 2.
- Scope-collision incidents observed in these two samples: 0.
- Direct-main mutations observed in these two samples: 0.
- Merge after exact-head verification + independent review: 2/2.

Interpretation: the isolated branch/resource-scope pattern worked as intended in these two bounded samples. This is not a global historical success rate.

## automated-code-review-gate

### Observed USE
- #2194 reviewed PR #2193 at exact head and returned PASS after CI, Queue Hygiene, and Vercel Online Verify passed.
- #2196 reviewed PR #2195 at exact head and returned PASS after the same required checks passed.

### MEASURE
Observed bounded review samples: 2.
- Exact-head review present: 2/2.
- Required checks PASS before merge: 2/2.
- Reviewer source mutation observed: 0/2.
- Merge occurred only after review PASS: 2/2.

Interpretation: the independent exact-head review gate behaved as intended in these two bounded samples. This is not a global historical success rate.

## Remaining VALIDATED skills

No ACTIVE promotion or USE/MEASURE claim is made for:
- `document-normalization-ingest`
- `source-grounded-knowledge-retrieval`
- `external-research-capability-routing`
- `domain-skill-packaging`

They remain VALIDATED until evidence exists for their exact behavior.

## RETIRE decision

No retirement/deprecation action is justified by current evidence for the two ACTIVE skills. Future retirement requires evidence of ineffectiveness, unsafe overlap, supersession, or a better canonical mechanism.
