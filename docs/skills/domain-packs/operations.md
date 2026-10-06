# Operations Domain Pack

## Provenance

- Work Order: #4382
- Parent: #4377
- Packaging contract: `docs/skills/domain-skill-packaging/SKILL.md`
- Registry source: `docs/skills/registry.yaml`
- State: reusable composition manifest; not a new Skill Registry entry.

## Trigger

Use for operational coordination, decomposition, evidence tracking, and isolated parallel work that does not cross a protected execution boundary.

## Input

- Operational objective and dependencies.
- Current durable state/evidence.
- Required acceptance checks.
- Resource, device, credential, Production, or destructive-action boundaries.

## Reused ACTIVE skills

1. `context-budget-compaction` — retain relevant operational context and checkpoints.
2. `role-separated-execution` — separate planning/execution/review when useful.
3. `isolated-parallel-execution` — isolate independent work and preserve resource scopes.
4. `source-grounded-knowledge-retrieval` — retrieve durable evidence for decisions and verification.

## Output

A bounded operational plan/execution record with explicit dependencies, evidence, and next actions.

## Explicit gap

Specialized device, runtime, deployment, credential, or external-system mutations are not generic Operations skill authority.

Disposition: **KEEP** the existing capability-specific gates rather than creating a duplicate catch-all execution skill.

## Acceptance

- All referenced skills exist as ACTIVE.
- Independent scopes remain isolated.
- Blocked work can be parked without blocking unrelated sibling work.
- Capability-specific mutations remain governed by their existing contracts.

## Safety

This pack never bypasses Production, paid/financial, credential/secret, security/permission, destructive/irreversible, physical-owner, or App Chrome boundaries.
