# Finance Domain Pack

## Provenance

- Work Order: #4382
- Parent: #4377
- Packaging contract: `docs/skills/domain-skill-packaging/SKILL.md`
- Registry source: `docs/skills/registry.yaml`
- State: reusable composition manifest; not a new Skill Registry entry.

## Trigger

Use for finance-oriented knowledge work that can be completed by composing existing ACTIVE skills without implying financial transaction, accounting, payment, or protected decision authority.

## Input

- Finance objective and source documents/data references.
- Required output and acceptance criteria.
- Applicable financial, credential, Production, or approval gates.

## Reused ACTIVE skills

1. `document-normalization-ingest` — normalize supported source material.
2. `source-grounded-knowledge-retrieval` — ground analysis in durable sources.
3. `context-budget-compaction` — preserve relevant context and durable checkpoints.
4. `role-separated-execution` — separate analysis/review where risk warrants it.

## Output

A source-grounded finance work product plus explicit evidence references and any unresolved domain gap.

## Explicit gap

TigerIQ currently has **no ACTIVE finance-specific calculation/modeling/accounting execution skill**.

Disposition: **NEW**, but only after a real recurring finance workflow provides measured trigger/input/output/acceptance evidence. This pack must not simulate that missing capability.

## Acceptance

- Every referenced skill exists as ACTIVE in the registry.
- The output cites or durably references source evidence.
- No finance-specific authority is inferred from generic skills.
- Missing domain execution remains explicit rather than silently filled.

## Safety

This pack does not authorize payments, purchases, bank actions, credit decisions, credential use, Production changes, destructive actions, or regulated financial execution. Those remain separate hard gates.
