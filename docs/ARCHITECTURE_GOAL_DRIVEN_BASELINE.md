# TigerIQ — Goal-Driven Optimization Baseline

Status: Proposed architecture baseline
Owner directive: 2026-09-18
Parent: #822

## 1. Goal
TigerIQ optimizes for one outcome: Owner states a goal once, the system turns it into verified execution with durable state, bounded parallelism, independent review, and evidence. New techniques from external videos/tools are inputs for evaluation, not automatic reasons to redesign the system.

## 2. Preserve first
Keep the current components when they already satisfy the goal:
- GitHub main as canonical source; branch → PR → checks → review → merge.
- CENTRAL #280 as authoritative queue/router.
- Registry #335 for workforce/resource identity and routing.
- Interaction #504 for Owner/Checkpoint behavior.
- TigerIQ Core as 24/7 manager/router for API/local resources.
- Chrome Controller + Worker Utility for NV02/NV03/NV04 UI workers.
- #788 Durable Session Handoff Ledger for durable save/resume receipts.
- #581 SurfSense integration as on-demand sourced research/knowledge input.
- Existing provider pool and free/local-first routing.

## 3. Non-goals
- Do not rebuild a working subsystem because a new tool appears in a video.
- Do not create another parallel source of truth.
- Do not turn API resources into fake background employees.
- Do not make Owner supervise checkpoints or manually dispatch workers.
- Do not increase paid, Production, credential, security, or irreversible authority.

## 4. Operating architecture
Owner goal
→ Vy intake / priority / policy gate
→ CENTRAL authoritative objective/work order
→ TigerIQ Core decomposition + routing
→ isolated execution scopes
→ checkpoint/evidence
→ independent review
→ verification
→ authoritative state update
→ concise Owner report.

Three supporting capabilities are standardized:
1. Durable resume: SAVE → CONTINUE; chat loss must not lose work.
2. Project/code knowledge index: source-aware retrieval to avoid rereading broad context.
3. Orchestration visibility: show objective, owner/resource, phase, checkpoint, next action, blocker and evidence from real state only.

## 5. Parallelism and ownership
- One active mutation owner per resource scope.
- Parallel work is allowed only when file/resource scopes do not overlap.
- Reviewer must be independent from implementer when the gate requires it.
- API/local resources may analyze/review/research in parallel; source mutation remains GitHub-controlled.
- Worker Utility scope remains isolated while #820 is active.
- manager-json scope remains isolated while #791 is active.

## 6. Checkpoint contract
Checkpoint is a durable save point, not a stop.
Trigger a checkpoint on:
- important phase completion;
- meaningful implementation/test result;
- before risky or interruptible transition;
- approximately every 5–10 minutes on long tasks when there is new progress.

A checkpoint records at minimum:
- objective/work item;
- completed work;
- evidence;
- current owner/lock;
- current phase;
- blockers/waits;
- exact next action.

After a valid checkpoint, continue automatically unless DONE, real blocker, external wait, or required authorization.

## 7. Knowledge index contract
The index is an accelerator, not authority.
It should index/reference:
- canonical repo files and symbols;
- issues/Work Orders/PRs;
- ADR/decisions;
- evidence and current-state references.

Requirements:
- every retrieved item retains source reference;
- stale/deprecated entries must not override current source;
- unknown facts remain unknown;
- rebuild/incremental refresh must be reversible;
- no secret/private data is copied into public indexes.

## 8. Visibility contract
A dashboard is read/observe first. Minimum fields:
- objective;
- priority;
- phase;
- active mutation owner/resource;
- active/recent jobs;
- last checkpoint;
- next action;
- blocker/wait/authorization;
- latest evidence reference.

No synthetic RUNNING/PASS/DONE values.

## 9. Implementation order
Stage 0 — baseline/acceptance contract: this document + #822.
Stage 1 — durable resume automation: extend/reuse #788; avoid duplicate ledger.
Stage 2 — minimal project/code knowledge index with source references.
Stage 3 — orchestration visibility using current Core/CENTRAL truth.
Stage 4 — final E2E regression.

No stage may rewrite an existing subsystem unless evidence shows the existing path cannot satisfy acceptance.

## 10. Acceptance metrics
Final E2E must prove:
1. Owner gives one goal once.
2. System decomposes and routes useful independent work.
3. At least two non-overlapping resources can contribute without duplicate mutation.
4. A forced chat/session interruption loses no durable work.
5. Resume occurs from authoritative state without Owner restating the task.
6. Checkpoint does not pause execution by itself.
7. Independent review catches/blocks a seeded defect or confirms a valid result.
8. Final state/evidence can be recovered in a new chat.
9. No direct main, paid action, credential/security widening, Production release, or destructive step occurs without its gate.
10. Existing Chrome worker work remains unaffected during foundation rollout.

## 11. Decision rule for future video/tool lessons
For every new idea:
- KEEP if TigerIQ already has an equivalent path that meets the goal.
- IMPROVE only if evidence shows a reliability/speed/cost/maintainability gap.
- REJECT/DEFER if benefit is unproven, duplicates authority, increases fragility, or distracts from the Owner goal.

Trend novelty is never an acceptance criterion.
