# TigerIQ Self-Improving Core v1 — CHECKPOINT

Parent authority: #462. Program ledger: #469.
Foundation: Context Plane v3 #460 / PR #461.
Branch: `p0/self-improving-core-v1`.
Runtime impact: NONE. MAIN/Production unchanged.

## Implemented
- `packages/self-improvement/src/index.ts`
  - observation -> deduped improvement candidate
  - impact/frequency/confidence/cost/risk prioritization
  - evidence-gated verified lessons
  - independent implementer/reviewer/judge enforcement
  - stale lesson retirement + supersede lifecycle
  - project-wide performance SLO/budget assessment
  - global resource scheduler with class capacity + keyed locks + foreground queue priority
  - checkpoint/heartbeat write coalescer with bounded freshness
  - improvement cycle that creates backlog only; no self-adoption
- `packages/event-store/src/latest-index.ts`
  - warm-once read-side latest/version index
  - repeated hot latest reads avoid full replay after canonical warm
  - explicit invalidation for possible out-of-process writes
  - canonical FileJournal/hash-chain remains unchanged
- CI candidate optimization
  - cancel superseded CI runs per PR/ref
  - npm dependency cache
  - quality gate commands unchanged
- Architecture: `docs/ARCHITECTURE_SELF_IMPROVING_CORE_V1.md`
- Regression: `tests/self-improvement.test.ts`, `tests/journal-latest-index.test.ts`

## Child work
- #463 Event Store fast path
- #464 Global Scheduler
- #465 Learning engine
- #466 Performance SLO
- #467 CI performance
- #468 Write coalescing
- #470 independent review/judge gate
- #471 verified knowledge lifecycle
- #472 scheduled daily audit contract
- #473 unified improvement backlog
- #474 authority/history hygiene
- #475 zero-cost guard

## Safety invariants
- No self-authorization of MAIN/Production.
- No paid/credential/security/reboot/irreversible action.
- No NV04/NV05 activation.
- No APP #441 takeover/resource conflict.
- Current CENTRAL #280 and Registry #335 unchanged by this candidate.
- Unverified observation never becomes active lesson.
- Engineering verification requires independent implementer/reviewer/judge.

## Remaining before any adoption
1. Exact-head CI/typecheck/unit/Playwright/build.
2. Review failures and fix/retest if any.
3. Shadow integration design against current runtime (no effect mode).
4. Explicit canary gate before physical/runtime adoption.
5. Physical metrics + rollback evidence before fleet.

State: `ISOLATED_CANDIDATE_IMPLEMENTED_CI_PENDING`.
