# WO-007 — PC Local AI Execution Worker

Priority: P0
Status: IN PROGRESS — PC INSTALL/EXECUTION EVIDENCE PENDING
Date: 2026-08-29

## Objective
Make the existing PC a zero-cost local AI Execution Worker that preserves Work Order execution when cloud AI providers are quota-limited or unavailable.

## Acceptance criteria
- Audit actual PC OS, CPU, RAM, GPU and VRAM before selecting a model.
- Install/configure Ollama or a better justified free local runtime.
- Verify local inference and an OpenAI-compatible localhost endpoint.
- Integrate provider priority/fallback/circuit-breaker with local AI as resilient fallback.
- Preserve Work Order state across provider failure and process restart.
- Worker lifecycle: receive Work Order → execute → evidence → independent review/gate → state update.
- Health/readiness and restart recovery verified.
- No secrets/tokens committed.
- No MAIN/Production mutation before gate.
- Demonstrate one sample Work Order end-to-end while cloud providers are deliberately simulated unavailable.

## Required PC audit evidence
Capture without secrets:
- OS/version and architecture
- CPU model/core count
- total RAM
- GPU model(s), VRAM/adapter memory, driver/runtime availability
- free disk space
- installed Git/Node/npm/Python/Docker/Ollama versions where present
- localhost/network constraints relevant to worker service

## Model selection policy
Do not hard-code a model before hardware audit. Prefer the smallest capable coding/reasoning model that fits actual RAM/VRAM with acceptable latency. Ollama is the default runtime because it is free/local and provides an OpenAI-compatible API surface; alternatives require evidence of a better fit.

## Routing policy
Cloud providers remain policy-driven candidates. Provider failures open bounded circuit state after a configurable threshold and fall through without losing Work Order state. Local provider does not require cloud credentials. Total provider exhaustion fails closed with bounded attempt evidence.

## Security
Secrets only through local environment/secret store; never repository files, evidence payloads, logs, or Trello. Local endpoint defaults to loopback. Public exposure requires a separate security gate.

## Implemented on `wo007/pc-local-ai-worker`
- Concrete Ollama adapter using loopback OpenAI-compatible `/v1/chat/completions`.
- `TIGERIQ_OLLAMA_MODEL`/explicit option resolves the placeholder local model after hardware audit; no model is prematurely hard-coded.
- Provider circuit breaker with configurable failure threshold and cooldown.
- Router tests covering cloud failure → local Ollama fallback and open-circuit → local fallback.
- `scripts/pc-worker/audit.ps1` for secret-free Windows hardware/runtime audit.
- `scripts/pc-worker/test-ollama.ps1` for Ollama health, installed-model check, and local OpenAI-compatible inference smoke test.

## Current evidence
- Existing Phase 9 branch supplies executable provider-neutral failover plus durable Work Order/restart foundations.
- Repository-side implementation is active on draft PR #18; MAIN/Production remain untouched.
- Ollama installation is currently being performed on the physical PC by the Owner.
- Actual PC audit, local inference latency/model fit, and end-to-end physical-PC execution still require execution evidence from that PC.

## Remaining gate
1. Run the committed PC audit after Ollama installation completes.
2. Select/pull the local model from actual RAM/VRAM evidence.
3. Run `test-ollama.ps1` and capture endpoint/inference evidence.
4. Wire the local adapter into the worker execution composition root and verify durable Work Order recovery.
5. Simulate cloud unavailable and prove one Work Order end-to-end through local execution, independent review/gate, evidence, and state update.

Do not mark DONE until all five are evidenced.
