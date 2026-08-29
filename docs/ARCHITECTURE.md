# TigerIQ AI Lab — Architecture Baseline

Status: Approved direction / implementation baseline to be verified incrementally.

## Operating flow
Owner → Chief of Staff → Work Order → AI Employee/Department → Model Router → Execution → Independent Review → Judge/Gate → Evidence → State/Memory → Owner Report

## Required boundaries
- Owner retains authority for strategy, financial commitments, production releases, and irreversible actions.
- Chief of Staff orchestrates intake, decomposition, coordination, evidence, and reporting.
- Engineering execution separates Builder, Reviewer, and Judge when the applicable gate requires independence.
- Model routing prefers free/low-cost capable models, escalating only when risk/complexity justifies it.
- Evidence is mandatory for material claims, test results, CI state, deployment state, and completion.
- Stable behavior/data must be preserved through incremental and reversible changes.
- MAIN/Production changes require the applicable release gate and authorization.
- Secrets and restricted/private Owner context must not be committed to general source control.

## Engineering Source of Truth
Repository engineering truth is maintained through:
- `docs/CURRENT_STATE.md`
- `docs/ARCHITECTURE.md`
- `work-orders/`
- ADRs / implementation docs as introduced
- CI/test/review/deployment evidence

## Current implementation status
Do not infer implementation completeness from this architecture document. Actual implementation status is recorded in `docs/CURRENT_STATE.md` and verified against repository/CI evidence.
