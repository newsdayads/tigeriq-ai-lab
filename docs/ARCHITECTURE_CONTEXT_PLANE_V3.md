# TigerIQ Context Plane v3 — Fast-Start / Lazy-Load

## Goal
Prevent project-wide stalls as AI employee count grows. Runtime startup must not replay GitHub issue/comment history. The active project remains unchanged until this candidate passes gates and receives explicit adoption.

## Isolation boundary
- Branch: `perf/context-plane-v3` only.
- No MAIN/Production mutation.
- No CENTRAL #280 / Registry #335 / current runtime mutation from this branch.
- No NV04/NV05 activation.
- No PC01 install/update/reload in this phase.

## Target topology
`Bootstrap -> GLOBAL_HOT_INDEX -> NVxx HOT STATE -> work`

Deep sources are lazy:
`HOT STATE -> work item / PR / evidence / comments` only when a defined trigger requires them.

## Components
### 1. GLOBAL_HOT_INDEX
A compact immutable snapshot generated from current authorities. Contains only:
- CENTRAL revision pointer;
- Registry revision pointer;
- command -> employee mapping;
- employee -> HOT STATE pointer;
- activation/background flags.

It does not contain issue/comment history.

### 2. Per-employee HOT STATE
Small immutable/revisioned state containing:
- current work;
- lease/resource owner;
- checkpoint pointer;
- next action;
- blockers/open gates;
- evidence pointers;
- authority revisions used to build the state.

### 3. Shared ContextPlane cache
All employees in one runtime share:
- revision-addressed cache;
- request coalescing for concurrent reads;
- byte/read metrics;
- explicit invalidation.

Concurrent requests for one source/revision collapse to one source fetch.

### 4. Lazy deep-read
No issue comment history, PR discussion, full evidence or parent issue chain is loaded during the normal startup path.

Deep-read triggers are limited to:
- HOT STATE missing/invalid/stale;
- ownership/lease conflict;
- new physical finding;
- missing acceptance detail;
- release/gate evidence decision;
- explicit audit/review request.

### 5. Fail-closed
Performance optimization never weakens authority.
- Unknown command -> fail closed.
- Disabled employee -> fail closed.
- HOT STATE employee mismatch -> fail closed.
- HOT STATE authority revision mismatch -> `HOT_STATE_AUTHORITY_STALE`, request deep refresh; do not infer from memory/chat.

## Budgets
Normal cold startup target per employee:
- 1 shared GLOBAL_HOT_INDEX read per revision across the runtime;
- 1 employee HOT STATE read per employee/revision;
- 0 deep reads;
- 0 comment-history reads.

Warm startup target:
- 0 source fetches while the same immutable revisions remain cached.

Fleet behavior:
- N employees must not cause N reads of GLOBAL_HOT_INDEX.
- A six-employee concurrent start should produce 1 global fetch + 6 compact HOT STATE fetches, not 6 copies of CENTRAL/Registry/history fetches.

## Event-driven invalidation
Source revision/SHA is the cache key. New GLOBAL_HOT_INDEX or HOT STATE revision creates a new key. Mutable refs are allowed only for discovery and use a short TTL; runtime snapshots should be revisioned.

## Migration phases
### Phase A — isolated candidate (this branch)
Implement library + deterministic regression tests. No runtime adoption.

### Phase B — shadow mode
Existing runtime remains authoritative. Context Plane builds/loads snapshots in parallel for metrics only. Compare resolved command/state against current path. Any mismatch blocks adoption.

### Phase C — canary one employee
After explicit approval, enable fast-start for NV02 only while retaining legacy fallback. Verify startup latency, command routing, lease, evidence and failure behavior.

### Phase D — fleet adoption
Enable for all active employees only after canary evidence. Preserve rollback switch to legacy path.

## Acceptance before adoption
- CI/typecheck/unit/Playwright/build PASS.
- Concurrent coalescing regression PASS.
- Cache revision invalidation PASS.
- Stale authority fail-closed PASS.
- Deep-read remains zero on normal startup PASS.
- Shadow comparison produces no routing/state divergence.
- PC01 physical latency evidence demonstrates improvement without foreground regression.
- Rollback path verified.

## Non-goals
- No change to current employee activation policy.
- No merge/deploy in this work item.
- No deletion of historical evidence.
- No weakening of Source of Truth, lease, review, security or Owner gates.
