# WO-043 — AI Coordinator

Priority: P0
Status: ENGINEERING VERIFIED ON FEATURE BRANCH — MAIN/PRODUCTION NOT AUTHORIZED
Date: 2026-08-31
Issue: #110
PR: #111
Branch: `wo043/ai-coordinator`

## Scope
Bộ Điều Phối AI only. No App UI or Web Control UI changes.

## Source-of-Truth constraints
- Free/low-cost first, but never below the capability required by the task.
- Stable behavior must be preserved.
- Engineering/high-impact work must not let the executor review or judge itself.
- No paid-service activation, automatic purchase, credential commit, or Production release.

## Real-state audit
1. `packages/model-router` already had provider adapters, static ordered failover, circuit breaking and sanitized attempt metadata for OpenAI, Anthropic, Gemini and Ollama.
2. `packages/orchestrator` already checked distinct actor IDs, but it did not select models by task/risk/cost, persist task-level checkpoints, or bind executor/reviewer/judge model identity.
3. `api/chief.mjs` uses Vercel AI Gateway with a configured primary/fallback list for Chief intake; it is not the Work Order execution/review/judge coordinator.
4. Critical mismatch found in `scripts/pc-worker/worker-github-queue.py`: Executor, Reviewer and Judge were all using the same `TIGERIQ_OLLAMA_MODEL`, so the runtime was not model-independent even though older documentation described independent roles.

## Delivered
- [x] Task-aware selection by work kind, risk, minimum quality and cost rank.
- [x] Default low-cost capable route starts with PC01/Ollama when its quality profile is sufficient.
- [x] Provider/model failover across configured adapters on quota/outage/timeout/auth/configuration/invalid response/unknown failure.
- [x] Bounded attempts per stage; no infinite retry loop.
- [x] Persistent checkpoint contract plus atomic JSON file store for restart recovery without repeating completed stages.
- [x] Executor/reviewer model identity separation for all coordinated work.
- [x] Strict three-way executor/reviewer/judge model identity separation for coding or high-risk work.
- [x] Evidence records role/provider/model/attempt/outcome/failure class/output digest without raw prompt/output/credential values.
- [x] PC01 GitHub queue worker changed to separate `TIGERIQ_OLLAMA_EXECUTOR_MODEL`, `TIGERIQ_OLLAMA_REVIEWER_MODEL`, `TIGERIQ_OLLAMA_JUDGE_MODEL`.
- [x] PC01 defaults to strict independent-AI gate and fails closed with `TIGERIQ_PC01_INDEPENDENCE_BLOCKED` instead of falsely claiming independent PASS when distinct role models are unavailable.
- [x] Tests cover low-cost routing, fallback, retry bound, strict independence, restart recovery, evidence privacy and PC01 anti-self-review policy.
- [x] Typecheck, unit tests, Playwright smoke, build, Queue Hygiene and Vercel Online Verify pass on implementation head `3c6a3b61449a91d213d8d19034a7bf47a6945710`.

## Gate history
- Initial PR head exposed TypeScript nullable-stage errors. Root cause: TypeScript could not prove that an async stage helper persisted a stage artifact.
- Fix: explicit fail-closed artifact checks after executor/reviewer/judge stages; no non-null assertion shortcut.
- Implementation head `3c6a3b61449a91d213d8d19034a7bf47a6945710`:
  - CI run `33356514883`: PASS.
  - Queue Hygiene run `33356514902`: PASS.
  - Vercel Online Verify run `33356514905`: PASS.

## Runtime activation boundary
No live paid provider is activated by WO-043. No credential/model token is committed. No live cloud independent-review call is claimed. The only PC01 local model independently confirmed by earlier physical evidence is `qwen2.5-coder:14b`; therefore the corrected PC01 worker will not claim three-way independent AI until two additional distinct role models (local or centrally routed providers) are genuinely available and configured outside source control.

## Release boundary
PR #111 remains open. MAIN/Production is untouched by WO-043. Merge/deployment requires the normal release authorization/gate.
