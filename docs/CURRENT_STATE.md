# Current State

Date: 2026-09-03

TigerIQ AI Lab remains evidence-gated. MAIN/Production are unchanged by WO-057; no automatic merge or production release is authorized.

## Active priority — WO-057 PC01 Primary AI Compute & Control Node

Status: DONE — PHYSICAL PC01 E2E A→G PASS

Branch: `wo057/pc01-primary-ai-compute-node`
Base: `wo056/pc01-one-click-bootstrap`
Repository gate evidence: `docs/evidence/WO-057-REPOSITORY-GATE-2026-09-03.md`
Physical evidence: `docs/evidence/WO-057-PC01-PRIMARY-NODE-E2E-20260903T084302Z.json`
Physical evidence run head: `3bc06fdd5e1049e8b3ac7a6c093854a2562cd122`
Physical evidence commit/push head: `1f2e8ced3a066c52cb1da387c526f632a35563d6`
GitHub Actions baseline run: `33720417131` PASS on Linux + Windows.

### Repository implementation
- PC01 Native Worker V1 independent of OpenClaw.
- Authenticated Work Order intake/readback.
- Signed registration, heartbeat, lease, lease renewal and result/failure submission.
- Ollama `qwen3:8b`, `num_ctx=4096`, `think=false`.
- Local-AI semaphore max concurrency = 2.
- Capability/model router and Safe Tool Executor.
- CPU/free-RAM telemetry and admission guard.
- Evidence persistence under `.tigeriq-runtime/evidence/` with PostgreSQL references.
- Existing canonical Workforce Controller Scheduled Task reused; PC01 Native Worker Scheduled Task installed.
- Controller installer provisions required `pg@8.16.3` runtime dependency idempotently after `npm ci`.

### Physical PC01 verification — PASS
- A Health: Controller healthy; PostgreSQL healthy; `qwen3:8b` available; PC01 worker online/health=ok.
- B Workforce: employees=1; devices=1.
- C Local AI: real Work Order completed; model=`qwen3:8b`; processor=`100% GPU`; valid structured output/evidence persisted.
- D Tool Executor: fixture read + deterministic artifact write PASS.
- E Failure handling: intentional missing-file job failed correctly and durable failure evidence was recorded.
- F Concurrency: two local-AI execution intervals overlapped; configured localAiMax=2.
- G Recovery: Controller + Worker stop/start recovery PASS; post-recovery Work Order stage=`done`.
- Runtime config: contextLength=4096; deployed think=false; PC01 online/healthy.
- Physical evidence `allPass=true`.
- MAIN/Production untouched; OpenClaw unused; no secrets printed.

### Resolved blockers during physical rollout
- Controller failed after `npm ci` because runtime `pg` was absent; installer was corrected to provision pinned `pg@8.16.3` idempotently.
- Recovery harness initially dirtied the repo before invoking the clean-repo installer; orchestration was corrected.
- Physical E2E `Assert([bool]...)` was incompatible with a PowerShell 5.1 runtime value; assertion handling was made PowerShell 5.1 safe.

### Remaining gate outside WO-057
Merge/release to MAIN/Production remains a separate explicit authorization gate. Independent cloud/model reviewer capability is not claimed and was not required for the completed physical A→G gate.

## Historical verified foundation

Earlier TigerIQ phases established governance/contracts, Work Orders/evidence, authorization, durable state/journal concepts, authenticated control-plane foundations, runtime safeguards and provider-neutral routing foundations. Historical evidence remains in its original Work Orders/evidence records.

## Historical — WO-007 PC Local AI Execution Worker

Previous status: PHYSICAL GATES PASS — PC01 AUTO MODE READY at the 2026-08-29 baseline using the prior local-worker architecture and `qwen2.5-coder:14b`. That historical result is retained as evidence but WO-057 now supersedes it for the PC01 Primary AI Compute & Control Node architecture.
