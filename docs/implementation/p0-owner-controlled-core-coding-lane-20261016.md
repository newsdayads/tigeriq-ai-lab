# P0 — Owner-controlled Core + Coding Lane execution contract

Approval: Owner direct, 2026-10-16. **Scope A only**: Core + Coding Lane first; expand only after final acceptance.
Authoritative source: GitHub main, Bootstrap, Issue 280 (central queue), Issue 504 (interaction/authority), Issue 1456 (execution lifecycle).
Baseline at branch creation: `cdec13873c63004fb8761a932bf9a26804b35f24`.
GitHub working branch: `p0/owner-vy-core-coding-contract-20261016`.

## Hard freeze and authority

- **Owner controls P0**; Vy coordinates. Workers including NV02 may only perform explicitly bounded execution, not autonomous P0 project decomposition/release.
- Branch-only source changes and isolated tests are authorized. **NO merge to main, NO PC01 installation/restart/release, NO Production, NO App Chrome changes** without Owner's later review and explicit approval.
- No new scheduler/queue/control plane. No new cost, secrets, permission changes, unauthorized machine writes, release/branch-protection bypass, or claim of live Core lease from GitHub write authority.
- Any independent GitHub source write uses branch/PR. For qualified scope the existing Owner waiver permits review *waiver*, not a fabricated independent approval; exact-head required checks and additional task-specific functional acceptance remain mandatory.
- Existing unfinished PRs remain untouched; one verified writer per mutation scope. Read-only audit does not require the Core writer lease.
- No percentage or DONE without accepted checklist evidence. Do not confuse 40 API Doctor/bootstrap jobs marked `done` with shipped software features.

## Verified root-cause snapshot, not current full-system statistics

PC01 read on 2026-10-16 (previous Owner audit): Coding Lane most recent 30 jobs: 29 failed, 1 done; most recent 20 coding objectives: 19 blocked, 1 completed. Failure classes included output-contract exhaustion (15), resources unavailable (6), all-batches-noop (3), no implementer (2), busy (1), HTTP 422, and a null-class failure. Core 40 recent jobs consisted of 38 API Doctor analysis jobs and 2 NV07 read-only/bootstrap canaries.

The merged DeXCam PR 4856 changed only a 25-line markdown-style file `apps/dexcam-personal`, not the Gradle/Manifest/Kotlin files required for a functioning Android module. All three generic CI checks passed; that is not Android functional acceptance. The DeXCam source Work Order 4625 was closed completed while its checklist/body still indicated unfinished work. Another Core objective reached 30 manager cycles on the old source. The same NVIDIA repair family spawned multiple failed coding jobs.

Code-read findings: Core `task-prompt-compiler.mjs` supports step/acceptance/evidence packets for compiled tasks, but `coding-lane.mjs` currently asks its manager to emit only title/instruction/paths for ONE job and does not call the active Skill loader. Existing Core Skill matcher is lexical with a maximum of 3 skills and 6000 characters. Generic CI/checks or review waiver are insufficient to prove product function. Existing retry guards are local and may not prevent repeated objectives across source epochs. Preserve legitimate progress and do not regress existing Core routing.

## G1–G6 — one acceptance package, incremental branch edits

| Gate | Required product | Deterministic acceptance |
|---|---|---|
| G1 Baseline | Frozen source/runtime snapshot, overlapping PR check, defined allowed paths, rollback path | SHA, current issues and actual service evidence; no live mutation |
| G2 Prompt contracts | Role-specific planning, implementation, independent review and acceptance prompts per step | Stable step_id, source_revision, skill refs, actions, required real artifacts, tests/evidence, terminal criteria; invalid packets rejected |
| G3 Skill & capability | Verified ACTIVE skills injected into Coding Lane, per-role capability and explicit skip/fallback | Actual skill ids/versions/bytes persisted; never claim CANDIDATE ACTIVE; no generic fallback for mandatory absent skill |
| G4 Dispatch/anti-loop | Cross-attempt identity based on canonical work order, step, source revision, failure signature | No duplicate writer, no replay same accepted step; max 2 same-failure attempts without material change; clear parked/wake event; other eligible independent work continues |
| G5 Product acceptance | Deterministic, deliverable-specific source and test verification | Markdown placeholder cannot pass Android source gate; checks cannot substitute build/e2e; Owner waiver is not QA pass; closed issue with unaccepted checklist is not DONE |
| G6 Full integration | Isolated regression suite + representative multi-step workflow + negative cases + rollback drill | CI exact SHA, live authorized E2E *only after separate Owner approval*, no false DONE/merges/production claims |

## Evidence requirements before asking Owner for merge/release

- Branch commits, explicit source diff, automated tests with run identifiers and exact head SHA.
- Offline negative regression: DeXCam markdown-only changes must be rejected; valid required source paths must survive structural gate but still require real build/test.
- Offline anti-loop: same step+revision+failure no more than two attempts; new source revision/evidence explicitly allows reconsideration; accepted step cannot replay.
- Skill: active version/content truly loaded in bounded prompt; log applied and skipped skill reasons; capability match is explicit.
- Integration: verified worker output and independent acceptance; evidence-bound step advancement; no repeat of closed/accepted issue; restart/lease invariants tested.
- Record any P0 runtime capability, PC01 exact installed SHA and release ticket only as **NOT_VERIFIED** until separately authorized and read back.
- **Owner gate:** stop at draft PR and result packet for Owner; no merge or deployment in this authorization.

## Entry and exit

Owner-approved scope is G1–G6 on this isolated branch. Work cannot be called G6 DONE from generic green CI or schema-only tests. In absence of a legitimate isolated multi-step E2E, report G6 BLOCKED_WITH_EVIDENCE and require further scoped test authorization, rather than endless retries or false success.
