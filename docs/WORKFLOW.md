# Workflow

1. Audit real repository state.
2. Create a Work Order with scope, invariants and acceptance criteria.
3. Architect produces an ADR/specification.
4. Coding Agent implements only on an isolated branch/worktree.
5. Independent Reviewer reviews the diff.
6. QA executes static, unit, integration, E2E and Golden Dataset checks.
7. Evidence Engine records command, exit code, commit SHA, artifacts/logs and timestamp.
8. Judge evaluates evidence, never self-reported claims.
9. Gate Engine advances only when required evidence is PASS.
10. Release Manager may create PR/Preview; MAIN/Production remains privileged.

Gate order: CODE -> REVIEW -> TEST -> TYPECHECK -> BUILD -> CI -> PREVIEW -> PREVIEW SMOKE -> MERGE MAIN -> PRODUCTION -> PRODUCTION SMOKE -> DOCS/CURRENT_STATE -> DONE.

A pending/queued/running gate is not a blocker. On FAIL, root-cause, fix and retest. Stop only at DONE, REAL BLOCKER after safe fallbacks are exhausted, or EXTERNAL WAIT.
