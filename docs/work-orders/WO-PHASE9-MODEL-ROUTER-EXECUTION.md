# Work Order — Phase 9 Executable Model Router

Status: IMPLEMENTED / CI PENDING

## Scope
Turn the existing provider routing policy into an executable failover boundary without adding credentials, paid commitments, public exposure, or Production deployment.

## Acceptance criteria
- Deterministic policy-ordered routing.
- Provider adapters are replaceable and injected.
- Primary success returns immediately.
- Provider failure, empty output, or missing adapter safely advances to the next candidate.
- Exhaustion fails closed with attempt metadata that excludes prompt/credential payloads.
- Empty prompts and duplicate adapters are rejected.
- Automated tests cover primary, failover, exhaustion and validation.
- CI passes and CURRENT_STATE records evidence.

## Invariants
No MAIN/Production mutation. No secret provisioning. No paid provider activation. Existing Phase 0-8 behavior remains stable.
