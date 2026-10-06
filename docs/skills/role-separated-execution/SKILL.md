# Role-Separated Execution

## Identity
- ID: role-separated-execution
- Version: 1.0.0
- State: ACTIVE
- Target: orchestration
- Provenance: registry.yaml; current governance #280/#504/#335

## Trigger
Use for repository/source mutation, implementation/review workflows, or work where independent verification materially reduces risk.

## Input
- Work scope and acceptance.
- Assigned planner/implementer/reviewer/verifier identities.
- Resource scope, branch/PR, and current evidence.

## Steps
1. Make planner, implementer, reviewer, and verifier responsibilities explicit.
2. Enforce one active mutation owner per resource scope.
3. Keep reviewer independent from the implementing AI resource when required.
4. Review acceptance, tests, scope boundaries, and evidence before merge.
5. Verify terminal claims against runtime/repository evidence.

## Tools / Output
Use existing orchestration, GitHub, and review surfaces. Output explicit role ownership plus implementation/review/verification evidence.

## Acceptance
- Mutation ownership is unambiguous.
- Required independent review comes from a different AI resource.
- Merge/terminal status is backed by exact evidence rather than a claimed background worker.

## Evidence
- Governance #280/#504/#335.
- Existing branch -> PR -> exact-head checks -> independent-review flows.

## Fallback
If an independent reviewer or writer is unavailable, release/park the gated step rather than collapsing roles or inventing evidence.

## Safety
Never claim a background worker exists without runtime evidence. This skill does not authorize Production/runtime release, paid actions, credential/security changes, or destructive operations.

## Non-goals
It does not require maximum role separation for trivial read-only work and does not override explicit Owner/hard gates.
