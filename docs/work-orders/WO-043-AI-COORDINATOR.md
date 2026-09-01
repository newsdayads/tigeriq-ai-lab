# WO-043 — AI Coordinator

Priority: P0
Status: THREE-WAY INDEPENDENCE + ZERO-COST SAFE DEFAULTS REMEDIATED — FINAL EXACT-HEAD REGATE REQUIRED
Date: 2026-09-01
Issue: #110
PR: #111
Branch: `wo043/ai-coordinator`

## Scope
Bộ Điều Phối AI only. No App/Android, Web Control, PC01 runtime implementation, MAIN or Production changes.

## Source-of-Truth constraints
- Free/low-cost first, but never below the capability required by the task.
- Executor, Reviewer and Judge must use three distinct concrete provider/model identities for every coordinated work item.
- No paid-service activation, automatic purchase, credential commit or Production release.
- Missing billing-safe capacity must fail closed rather than silently selecting an unproven paid route.
- Cross-stream ownership must be respected; PC01 runtime/security belongs to the PC01 stream.

## Real-state audit
1. `packages/model-router` provides provider adapters, ordered failover, circuit breaking and attempt metadata.
2. `packages/orchestrator` actor separation alone does not prove provider/model independence.
3. `api/chief.mjs` is Chief intake, not the Work Order execution/review/judge coordinator.
4. WO-043 previously required the third distinct Judge only for coding/high-risk work; this violated the current universal three-AI instruction.
5. WO-043 default model profiles also still included generic OpenAI/Anthropic and generic Gemini routes that could not be assumed zero-cost.
6. PC01 implementation remains outside WO-043; billing-safe runtime provider policy/probing is tracked in #133/#134.

## Delivered in WO-043 scope
- [x] Task-aware selection by work kind, risk, minimum quality and cost rank.
- [x] Bounded provider/model failover; no infinite retry loop.
- [x] Persistent checkpoint contract plus atomic JSON file store for restart recovery without repeating completed stages.
- [x] Executor/Reviewer/Judge use three distinct concrete provider/model identities for every coordinated work item.
- [x] Judge always excludes both prior identities and fails closed if no third eligible identity exists.
- [x] Default routes are zero-cost-safe only: Ollama local + `openrouter/free`.
- [x] Generic OpenAI, Anthropic and Gemini API-capable routes are not auto-selected by default.
- [x] Billing-safe Gemini CLI / Claude subscription routes require explicit runtime injection after #133/#134 policy validation.
- [x] Evidence records role/provider/model/attempt/outcome/failure class/output digest without raw prompt/output/credential values.
- [x] Unit tests cover universal three-way independence, fallback, retry bound, restart recovery, evidence privacy and fail-closed zero-cost defaults.
- [x] Cross-stream boundary retained: PC01 worker implementation is not owned by PR #111.

## 2026-09-01 remediation evidence
Implementation/test head `02e0524debd5167fd7e611729d70e266a7f393b1`:
- Queue Hygiene `33533312758` — PASS.
- Vercel Online Verify `33533312736` — PASS.
- CI `33533312748` was still running when documentation synchronization began.

The final documentation head requires a fresh exact-head gate; historical runs are not enough.

## Runtime activation boundary
WO-043 defines orchestration mechanics but does not activate credentials or claim live three-provider semantic review. Runtime must supply three genuinely distinct eligible backend identities. Billing-safe/free/subscription provider activation is governed by #133/#134. PC01 execution remains outside this branch.

## Dependency boundary
- PR #127 is stacked on WO-043 and must be refreshed onto the final exact WO-043 head after this remediation.
- PR #131 contains Android v0.7 integration and must not be modified by this stream.

## Independent review boundary
All earlier review results became stale after the 2026-09-01 universal-independence and zero-cost-default changes. A genuinely independent review bound to the final exact head is required. Same-author/self-review is not independent evidence.

## Release boundary
PR #111 remains open and unmerged. MAIN/Production is untouched. Merge/deployment requires final exact-head automated gates, genuine independent PASS and normal Owner release authorization.
