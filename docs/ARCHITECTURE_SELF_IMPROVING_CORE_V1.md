# TigerIQ Self-Improving Core v1

Parent: #462. Foundation: Context Plane v3 #460 / PR #461.

## Objective
TigerIQ continuously improves its own architecture, workflows and runtime behavior from measured evidence without turning chat, assumptions or self-generated claims into authority.

## Control loop
`OBSERVE -> DETECT -> DEDUPE -> PRIORITIZE -> EXPERIMENT OFF-MAIN -> REVIEW -> JUDGE -> VERIFIED LESSON -> SHADOW -> CANARY -> FLEET`

A failed/rejected experiment returns to the backlog with evidence. It is not hidden and does not become a lesson.

## Knowledge model
Three states are intentionally separate:
1. Observation: a symptom/measurement. Never authoritative knowledge by itself.
2. Improvement Candidate: deduped/scored work hypothesis. Safe to implement OFF-MAIN only.
3. Verified Lesson: requires evidence + independent reviewer + independent judge. May guide later candidates; it still cannot self-authorize Production.

Lessons have a review horizon and can be retired/superseded when stale or contradicted.

## Priority scoring
Default score is proportional to impact × repeated frequency × confidence, discounted by implementation cost and risk. The scoring function ranks work; it never expands authority.

## Performance/SLO plane
Measure at minimum:
- startup_to_action_ms
- queue_wait_ms
- source_fetches
- bytes_loaded
- cache_hit_ratio
- deep_reads
- tool_latency_ms
- journal_latency_ms
- write_amplification

Candidate budgets fail closed on regression.

## Global scheduler
All AI employees share resource budgets by class: GitHub, browser, API, PC01, CPU and IO. Named resources are keyed locks. Foreground work has queue priority; active work is not silently preempted without a controlled checkpoint/yield path.

This prevents thundering-herd behavior when many employees wake at once.

## Write coalescing
Checkpoint/heartbeat persistence is coalesced when payload is unchanged, but bounded freshness forces a write after a configured maximum interval. Meaningful state changes always persist immediately.

## Event Store optimization
Current FileJournal integrity semantics remain canonical. #463 owns the candidate path for indexed latest/snapshot reads and eventual append metadata optimization. No hash-chain weakening is permitted.

## CI optimization
#467 may cancel superseded candidate runs and use dependency caches/path-aware expensive gates, but must never remove required exact-head release/adoption verification.

## Daily improvement contract
A real scheduler may run the audit cycle periodically. Each run:
1. read current authoritative dynamic state;
2. collect measurable regressions/repeated failures;
3. update/dedupe #462 improvement backlog;
4. implement only reversible OFF-MAIN work within the current authority envelope;
5. run gates and record evidence;
6. never merge/deploy Production automatically;
7. report only material result/blocker.

If no actual scheduler/runtime exists, TigerIQ must not claim that this loop is running.

## Adoption stages
A. Isolated code/test candidate.
B. Shadow: compare against current behavior; no authority effect.
C. Canary: one explicitly authorized scope/employee; legacy rollback available.
D. Fleet: only after measured improvement + no authority/routing regression + rollback evidence.

## Non-negotiable safety
- No MAIN/Production self-authorization.
- No paid/credential/security/irreversible change without explicit gate.
- One active owner per Work Order/resource.
- Coder, reviewer and judge independent when engineering gate requires it.
- Chat/history/memory are context, not authoritative state.
- Evidence must be preserved; optimization may compress pointers/state, not falsify/delete proof.
