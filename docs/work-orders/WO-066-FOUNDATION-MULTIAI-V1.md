# WO-066 — Foundation + Multi-AI V1

Date: 2026-09-04
Status: IMPLEMENTED — REPOSITORY GATE PENDING
Branch: `wo066/foundation-multiai-v1`
Base: `wo065/continuous-operations-v1`
MAIN/Production: untouched

## Objective
Prepare the safe repository foundation that can continue after WO-065 physical acceptance without requiring real provider credentials yet. Cover durable event/state primitives, recovery decisions, project isolation, secret-reference handling, normalized provider/model routing, employee resolution, bounded parallel scheduling, independent review and final judge decisions.

## Implemented

### Runtime foundation
- Append-only versioned Event Journal with ordered sequence and idempotency keys.
- Journal integrity verification.
- Separate runtime namespaces for `ai-lab` and `driver` queues/state/evidence/secrets.
- Heartbeat/stuck detection and bounded retry/restart decisions.
- Exponential retry delay with maximum attempts.
- Secret-reference contract; raw secret-looking values are rejected.
- Sensitive text redaction helper for evidence/log paths.

### Multi-AI foundation
- Provider Registry types for local/external providers, health, cost class, concurrency and quota.
- Model Registry with capabilities, quality, speed, context and cost weight.
- Normalized Model Router with free/local preference, capability filters, health/quota filtering and fallback.
- AI Employee Registry roles: chief, architect, researcher, coder, tester, reviewer, judge and operator.
- Parallel Scheduler selects dependency-ready tasks by priority and respects global/provider concurrency.
- Independent reviewer selection excludes the author model from sole approval.
- Judge decisions: PASS / FIX / BLOCKED / AUTHORIZATION.
- Workforce capacity calculation.
- Provider and employee templates prepared without real credentials.

## Safety
- No real API key is stored or requested by repository code.
- External providers are disabled by default in the template.
- No paid/provider network call is executed.
- No MAIN/Production merge or deploy.
- Existing WO-059 authorization policy remains authoritative for executable actions.

## Repository acceptance
PASS requires exact-head CI:
- typecheck;
- unit tests including runtime foundation and AI gateway suites;
- Playwright smoke;
- build;
- existing WO-065 PowerShell parser gate remains green.

## Remaining after repository PASS
1. WO-065 physical PC01 acceptance remains an upstream operational gate.
2. Wire durable journal/recovery primitives into live PC01 services.
3. Build live AI Gateway adapters; provider connectivity requires Owner-provided credentials.
4. Build Web Control live data/control surfaces and Cloudflare access layer.
