# Workflow

## State machine

`DRAFT -> APPROVED -> IN_PROGRESS -> IMPLEMENTED -> GATE_PENDING -> VERIFIED`

Exceptional terminal or retry states are `REJECTED` and `BLOCKED`. A rejected order returns through explicit revision and approval; it is never silently promoted.

## Roles and transitions

1. A human or authorized planner defines scope and measurable acceptance criteria in a Work Order.
2. An authorized approver moves it to `APPROVED`.
3. A Coding Agent implements on a non-`main` branch and records evidence. It may report only `IMPLEMENTED`.
4. A distinct gate actor runs lint, typecheck, tests, schema validation, build, review, and any order-specific checks.
5. The Gate Engine records `PASSED`, `FAILED`, or `BLOCKED` with evidence references.
6. Only a passed independent gate allows the control plane to label the Work Order `VERIFIED`.
7. Production merge or deployment requires explicit human authorization outside this lifecycle.

## Evidence requirements

Evidence must be attributable, timestamped, reproducible or immutable, and tied to the Work Order. A passing statement without an artifact or command result is not evidence. Missing evidence fails closed.

## Phase 0 gate

Run `npm run ci`. All of lint, typecheck, unit tests, schema compilation, and build must pass locally and in GitHub Actions. The draft PR and its CI run are external evidence.
