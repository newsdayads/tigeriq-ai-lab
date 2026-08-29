# WO-007 — PC Local AI Execution Worker

Priority: P0
Status: IN PROGRESS — PC ACCESS BLOCKER
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
- total/available RAM
- GPU model(s), VRAM, driver/runtime availability
- free disk space
- installed Git/Node/npm/Python/Docker/Ollama versions where present
- localhost/network constraints relevant to worker service

## Model selection policy
Do not hard-code a model before hardware audit. Prefer the smallest capable coding/reasoning model that fits actual RAM/VRAM with acceptable latency. Ollama is the default runtime because it is free/local and can provide an OpenAI-compatible API surface; alternatives require evidence of a better fit.

## Routing policy
Cloud providers remain policy-driven candidates. Retryable quota/rate-limit/outage/network failures open provider circuit state and fall through without losing Work Order state. Local provider must not require cloud credentials. Total provider exhaustion fails closed with durable evidence.

## Security
Secrets only through local environment/secret store; never repository files, evidence payloads, logs, or Trello. Local endpoint defaults to loopback. Public exposure requires a separate security gate.

## Current evidence
- Existing Phase 9 branch already has executable provider-neutral failover and durable Work Order foundations.
- This chat has GitHub/Trello access but no shell/remote-desktop/PC-management connector, so actual PC hardware inspection, package installation, service configuration and local inference execution cannot be truthfully performed from this runtime.

## Blocker
REAL BLOCKER: no execution channel to the physical PC is available to this agent. Resolving it requires exposing an authorized remote execution path (for example a TigerIQ worker bootstrap/agent, SSH/WinRM, or another connected PC-control tool). Once available, execution resumes from the hardware audit without re-planning.
