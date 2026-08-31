# WO-043 — AI Coordinator

Priority: P0
Status: REMEDIATED AFTER INDEPENDENT REVIEW — REGATE REQUIRED
Date: 2026-08-31
Issue: #110
PR: #111
Branch: `wo043/ai-coordinator`

## Scope
Bộ Điều Phối AI only. No App UI, Web Control UI, PC01 runtime implementation, MAIN or Production changes.

## Source-of-Truth constraints
- Free/low-cost first, but never below the capability required by the task.
- Stable behavior must be preserved.
- Engineering/high-impact work must not let the executor review or judge itself.
- No paid-service activation, automatic purchase, credential commit, or Production release.
- Cross-stream ownership must be respected; PC01 runtime/security belongs to the PC01 stream.

## Real-state audit
1. `packages/model-router` already had provider adapters, static ordered failover, circuit breaking and sanitized attempt metadata for OpenAI, Anthropic, Gemini and Ollama.
2. `packages/orchestrator` already checked distinct actor IDs, but it did not select models by task/risk/cost, persist task-level checkpoints, or bind executor/reviewer/judge model identity.
3. `api/chief.mjs` uses Vercel AI Gateway for Chief intake; it is not the Work Order execution/review/judge coordinator.
4. The existing MAIN PC01 worker used one `TIGERIQ_OLLAMA_MODEL` for Executor, Reviewer and Judge, which is not independent AI.
5. Independent review of PR #111 then found that WO-043 had crossed ownership by directly editing `scripts/pc-worker/worker-github-queue.py` while canonical PC01 recovery/security work was active on another branch. Security issue #114 also applies to that worker surface.
6. PC01 stream now has its own hardening candidate PR #116 based on `wo011/pc01-remote-exec`. WO-043 therefore must not own or overwrite PC01 runtime code.

## Delivered in WO-043 scope
- [x] Task-aware selection by work kind, risk, minimum quality and cost rank.
- [x] Default low-cost capable route can prefer a configured Ollama target when its profile meets the task requirement.
- [x] Provider/model failover across configured adapters on quota/outage/timeout/auth/configuration/invalid response/unknown failure.
- [x] Bounded attempts per stage; no infinite retry loop.
- [x] Persistent checkpoint contract plus atomic JSON file store for restart recovery without repeating completed stages.
- [x] Executor/reviewer model identity separation for all coordinated work.
- [x] Strict three-way Executor/Reviewer/Judge model identity separation for coding or high-risk work.
- [x] Evidence records role/provider/model/attempt/outcome/failure class/output digest without raw prompt/output/credential values.
- [x] Unit tests cover low-cost routing, fallback, retry bound, strict independence, restart recovery and evidence privacy.
- [x] Cross-stream remediation: direct PC01 worker modification and PC01-specific test removed from PR #111; PC01 runtime/security dependency is handed to #114/#116.

## Independent review finding and remediation
Independent audit on 2026-08-31 marked PR #111 FAIL because:
- WO-043 modified the PC01 worker concurrently with canonical PC01 recovery changes;
- that worker also had command-isolation security blocker #114;
- Issue #110 had been closed before the independent review completed.

Remediation performed:
- Issue #110 reopened.
- `scripts/pc-worker/worker-github-queue.py` restored to the exact MAIN blob so PR #111 no longer owns that file.
- `tests/pc01-independent-ai-policy.test.ts` removed from PR #111 because it tested another stream's implementation.
- PC01 hardening remains with PR #116 / issue #114.
- PR #111 requires fresh exact-head CI and a new independent review after this remediation.

## Runtime activation boundary
WO-043 defines coordinator policy and recovery mechanics but does not activate provider credentials or claim live three-provider semantic review. A runtime adapter must supply genuinely distinct model identities for strict coding/high-risk work. PC01-specific model configuration is owned by the PC01 stream.

## Release boundary
PR #111 remains open and unmerged. MAIN/Production is untouched by WO-043. Merge/deployment requires fresh exact-head gates plus independent PASS and normal release authorization.
