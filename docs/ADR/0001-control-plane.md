# ADR-0001: Evidence-gated control plane

Status: Accepted for V1 foundation.

## Decision
TigerIQ AI Lab will be a control plane, not a monolithic coding agent. AI workers are replaceable adapters governed by Work Orders, independent review, deterministic tests, evidence collection and release gates.

## Consequences
- Provider/model swaps do not change workflow semantics.
- A Coding Agent cannot self-approve.
- Deterministic evidence outranks model assertions.
- Local and cloud providers can coexist through the Model Router.
- MAIN/Production remain privileged release boundaries.
