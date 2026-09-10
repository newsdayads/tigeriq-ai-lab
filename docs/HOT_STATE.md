# TigerIQ HOT STATE

Status: derived fast-start index; **not an authority by itself**.

## Purpose
`docs/HOT_STATE.json` is the first compact read for ordinary current-state questions. It reduces repeated scans while preserving the existing Project Source / dynamic Source of Truth contract.

## Precedence
HOT STATE never overrides a higher source. Resolution remains:
1. Explicit current Owner instruction.
2. Project Bootstrap: Constitution → approved Architecture/Security → Workflow → Source Index → AI Employee Model → Baseline Decisions.
3. Dynamic authority inside that envelope: CENTRAL #280, Interaction #504, Registry #335, exact current issue/decision.
4. Current-state queue/work/runtime evidence.
5. Chat/history/memory/agent assumptions.

If HOT STATE conflicts with any higher source, it is stale. Stop the conflicting action and deep-read the authoritative source.

## Fast-start algorithm
1. Read `docs/HOT_STATE.json`.
2. Validate it with `node scripts/resolve-hot-state.mjs --check`.
3. For ordinary status, use its pointers and compact current state.
4. Deep-read only when the state is invalid/stale, a newer Owner instruction exists, sources conflict, fresh runtime evidence is required, a mutation/security gate is involved, or exact evidence was requested.

## Source classes
- **Project Source / Bootstrap:** core rules; stable; highest non-Owner contract.
- **Dynamic authority:** CENTRAL/Interaction/Registry/current issues and decisions.
- **Runtime evidence:** Controller/queue/leases/workers/releases/evidence; factual operational truth, not policy authority.
- **Archive/superseded:** old worktrees, releases, snapshots and historical chat; retained for rollback/evidence but excluded from current-state resolution.

## Repository company copies
Files under `docs/company/*_v1.md` are repository mirrors/history. Their filename/version does not make them current Project Source and they must never override the Project Bootstrap loaded by ChatGPT or newer allowed dynamic authority.
