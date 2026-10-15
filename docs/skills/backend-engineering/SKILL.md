# Backend Engineering — P0 Core/Coding Lane candidate

ID: backend-engineering
Version: 0.1.0
State: CANDIDATE — not runtime loadable until validated, real canary and registry promotion
Target: coding-lane / backend

## Trigger
A bounded API, service, worker, database migration or backend correctness change under an explicit Work Order.

## Required inputs
Canonical specification, endpoint/data contract, real failure evidence, source SHA, exact file scope, tests and permitted mutation boundary.

## Step-by-step prompt
1. Identify existing endpoint, input/output schemas, service dependencies, and data or writer ownership.
2. Reproduce reported defect with RED or document why reproduction is not feasible; do not claim an unobserved root cause.
3. Implement minimal schema-compatible code; preserve idempotency, timeouts, quotas, authorization, transaction and lease fencing.
4. Run focused unit/integration/negative tests including concurrent claim, stale writer, retry exhaustion and restart when applicable.
5. Return changed file evidence, exact SHA, reproducible commands, test results, unresolved blockers and the next safe step.

## Acceptance
Contract and negative tests must pass for the actual target version. A mock result does not prove real PostgreSQL or PC01 runtime behavior. No feature DONE based merely on a fast model response or generic CI.

## Security / permissions
No secrets, payment, production, authorization change, App Chrome or direct main write without separate scoped approval. Never infer Core resource lease from GitHub branch permission.

## Promotion
Canary on a bounded API fixture with real source contract test, independent review or documented Owner waiver and authorized registry promotion required before ACTIVE.
