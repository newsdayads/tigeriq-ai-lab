# Architecture

## Purpose

TigerIQ separates intent, implementation, verification, and audit so model confidence can never substitute for reproducible evidence.

## Logical components

1. **Control Plane** accepts an approved Work Order and manages its state machine.
2. **Agent Runtime** gives a Coding Agent a scoped task and least-privilege tools.
3. **Evidence Store** records command output, test reports, artifacts, reviews, and external checks with stable references and optional hashes.
4. **Gate Engine** independently evaluates acceptance criteria against evidence. The implementer cannot be the evaluator.
5. **Audit Log** appends actor, action, subject, time, details, and a previous-event hash for tamper evidence.
6. **Human Control** approves sensitive transitions, Production merges, deployment, secrets, and policy exceptions.

## Trust boundaries

- Prompts, repository content, dependency output, web content, and model claims are untrusted.
- Schemas validate shape, not truth; gate checks validate the underlying evidence.
- Credentials stay outside prompts, logs, source control, and evidence payloads.
- Production is a separate authorization boundary and is out of scope for autonomous agents.

## Phase 0 repository layout

- `packages/core`: domain types and verification invariant.
- `schemas`: versionable interchange contracts.
- `docs/adr`: durable architecture decisions.
- `.github/workflows/ci.yml`: reproducible quality gate.

Future phases may add persistence, orchestration, policy enforcement, and UI without weakening these boundaries.
