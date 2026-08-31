# WO-043 — AI Coordinator

Priority: P0
Status: IN PROGRESS — implementation on isolated branch; no Production release
Date: 2026-08-31
Issue: #110
Branch: `wo043/ai-coordinator`

## Scope
Bộ Điều Phối AI only. Do not modify App UI or Web Control UI.

## Source-of-Truth constraints
- Free/low-cost first, but never below the capability needed for the task.
- Existing stable behavior must be preserved.
- Engineering/high-impact work requires independent executor, reviewer and judge identities.
- No paid-service activation, automatic purchase, credential commit, or Production release.

## Audit finding
Existing `packages/model-router` already provides provider adapters, static ordered failover, circuit breaking and sanitized attempt metadata for OpenAI, Anthropic, Gemini and Ollama. Existing `packages/orchestrator` validates role assignment independence, but the two layers are not yet joined into a resumable task-level execution workflow.

## Required outcome
Normalize:
`Receive -> select executor -> independent review -> independent judge -> evidence -> status`

## Implementation checklist
- [x] Task-aware selection by kind, risk, minimum quality and cost rank.
- [x] Default free/low-cost capable order starts with PC01/Ollama when sufficient.
- [x] Provider/model fallback across configured adapters.
- [x] Bounded attempts per stage.
- [x] Persistent checkpoint contract plus JSON file store for resume after process failure.
- [x] Executor/reviewer identity separation for all work.
- [x] Strict three-way executor/reviewer/judge independence for coding or high-risk work.
- [x] Redacted evidence contains role/provider/model/outcome/failure classification/output digest, not raw prompt/output/credential values.
- [x] Tests cover low-cost routing, provider failover, retry bounds, strict independence, resume and evidence privacy.
- [ ] CI/typecheck/unit/build gates PASS on exact PR head.
- [ ] Update Current State and close issue after verified gate evidence.

## Runtime note
Provider secrets/model IDs remain external runtime configuration. This Work Order does not activate a paid provider or claim a live cloud call. PC01/Ollama live reachability remains dependent on the separate PC01 command-ingress recovery work; the coordinator itself is provider-neutral and can resume from persisted checkpoints.
