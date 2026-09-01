# WO-043 — AI Coordinator

Priority: P0
Status: THREE-WAY INDEPENDENCE REMEDIATED — EXACT-HEAD REGATE REQUIRED
Date: 2026-09-01
Issue: #110
PR: #111
Branch: `wo043/ai-coordinator`

## Scope
Bộ Điều Phối AI only. No App UI, Web Control UI, PC01 runtime implementation, MAIN or Production changes.

## Source-of-Truth constraints
- Free/low-cost first, but never below the capability required by the task.
- Stable behavior must be preserved.
- Executor, Reviewer and Judge must use three distinct concrete provider/model identities for every coordinated work item under the current Owner instruction.
- No paid-service activation, automatic purchase, credential commit, or Production release.
- Cross-stream ownership must be respected; PC01 runtime/security belongs to the PC01 stream.

## Real-state audit
1. `packages/model-router` already has provider adapters, ordered failover, circuit breaking and sanitized attempt metadata.
2. `packages/orchestrator` already checked distinct actor IDs, but it did not select models by task/risk/cost, persist task-level checkpoints, or bind executor/reviewer/judge model identity.
3. `api/chief.mjs` uses Vercel AI Gateway for Chief intake; it is not the Work Order execution/review/judge coordinator.
4. WO-043 originally separated Executor and Reviewer for all work but required a third distinct Judge only for coding/high-risk work.
5. Current Owner instruction on 2026-09-01 makes three-way independence universal, so the lower-risk reuse path was an owning defect and has been removed.
6. PC01 implementation remains outside WO-043 and is governed separately by #114/#116; zero-cost runtime provider policy/probing is tracked in #133/#134.

## Delivered in WO-043 scope
- [x] Task-aware selection by work kind, risk, minimum quality and cost rank.
- [x] Default low-cost capable route can prefer a configured Ollama target when its profile meets the task requirement.
- [x] Provider/model failover across configured adapters on quota/outage/timeout/auth/configuration/invalid response/unknown failure.
- [x] Bounded attempts per stage; no infinite retry loop.
- [x] Persistent checkpoint contract plus atomic JSON file store for restart recovery without repeating completed stages.
- [x] Executor/Reviewer/Judge use three distinct concrete provider/model identities for every coordinated work item.
- [x] Judge always excludes both prior identities and fails closed if no third eligible identity exists.
- [x] Evidence records role/provider/model/attempt/outcome/failure class/output digest without raw prompt/output/credential values.
- [x] Unit tests cover low-cost routing, provider fallback, retry bound, universal three-way independence, restart recovery and evidence privacy.
- [x] Cross-stream remediation retained: direct PC01 worker modification and PC01-specific test are not owned by PR #111.

## 2026-09-01 remediation evidence
Implementation/test head `f7fb806544134e443212729491cb2ff24930b956` passed:
- CI `33532040523`.
- Queue Hygiene `33532040524`.
- Vercel Online Verify `33532040600`.

These runs prove the implementation/test head only. Documentation synchronization commits after that head require fresh exact-head gates before repository PASS can be restored.

## Runtime activation boundary
WO-043 defines coordinator policy and recovery mechanics but does not activate provider credentials or claim live three-provider semantic review. Runtime must supply three genuinely distinct eligible backend identities. Billing-safe/free/subscription provider activation is governed by #133/#134. PC01-specific runtime execution remains outside this branch.

## Independent review boundary
The earlier independent PASS at the previous head became stale when the three-way policy changed. A genuinely independent review bound to the final exact head is required. Same-author/self-review must not be presented as independent evidence.

## Release boundary
PR #111 remains open and unmerged. MAIN/Production is untouched by WO-043. Merge/deployment requires fresh exact-head gates, independent PASS and normal Owner release authorization.
