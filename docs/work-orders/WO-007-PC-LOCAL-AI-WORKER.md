# WO-007 — PC Local AI Execution Worker

Priority: P0
Status: PHYSICAL GATES PASS — PC01 AUTO MODE READY; REPOSITORY RECONCILIATION/CI CLOSURE PENDING
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

## Physical PC01 result
- Ollama model: `qwen2.5-coder:14b`.
- Ollama local inference: PASS.
- OpenAI-compatible/local API: PASS.
- Worker and Watchdog are installed as Windows Scheduled Tasks.
- GitHub CLI authentication: PASS.
- Tailscale address observed: `100.97.23.87`.
- Duplicate Worker condition was found and reduced to exactly one Worker instance.
- Physical cloud-outage → Ollama E2E: PASS.
- Durable Work Order reconstructed/recovered status: `verified`.
- Independent REVIEW: PASS.
- Independent DONE judge: PASS.
- Physical watchdog self-heal after deliberate Worker kill: PASS.
- Post-recovery local inference returned `TIGERIQ_AUTO_MODE_PASS`.
- Final physical gate output: `[100%] TIGERIQ PC01 AUTO MODE READY`.

## Routing policy
Cloud providers remain policy-driven candidates. Provider failures open bounded circuit state after a configurable threshold and fall through without losing Work Order state. Local provider does not require cloud credentials. Total provider exhaustion fails closed with bounded attempt evidence.

## Security
Secrets only through local environment/secret store; never repository files, evidence payloads, logs, or Trello. Local endpoint defaults to loopback. Tailscale reachability does not authorize public exposure. Any non-loopback API exposure requires a separate security gate.

## Implemented on `wo007/pc-local-ai-worker`
- Concrete Ollama adapter using OpenAI-compatible `/v1/chat/completions`.
- `TIGERIQ_OLLAMA_MODEL`/explicit option resolves the local model.
- Provider circuit breaker with configurable failure threshold and cooldown.
- Durable Work Order worker composition root in `packages/worker/src/index.ts`.
- Worker resumes an already-running Work Order after process restart without recreating state.
- Successful execution records evidence before independent REVIEW and DONE gate decisions.
- Coder, reviewer and judge identities are required to be distinct.
- Total provider exhaustion records failing evidence and transitions the Work Order to `failed`.
- Router tests cover cloud failure → local Ollama and open-circuit → local fallback.
- Worker tests cover restart recovery, simulated cloud outage → local execution, independent reviewer/judge gate completion, fail-closed total exhaustion, and role independence.
- `scripts/pc-worker/audit.ps1` provides secret-free Windows hardware/runtime audit.
- `scripts/pc-worker/test-ollama.ps1` provides Ollama health/model/OpenAI-compatible inference smoke testing.
- `scripts/pc-worker/e2e-wo007.ps1` provides the one-command physical E2E gate.

## Repository evidence
- Draft PR #18; MAIN/Production remain untouched.
- Physical-E2E source head: `375e305b3c44f25ec076d9d2b4ada0d2c36f0fe6`.
- GitHub Actions CI #67 / run `33250789420`: PASS.
- Physical E2E evidence and watchdog recovery evidence are recorded in `docs/evidence/WO-007-REPOSITORY-GATE-2026-08-29.md`.

## Remaining closure gate
1. Let CI validate the documentation/evidence reconciliation head.
2. Reconcile CURRENT_STATE and PR metadata with the final physical evidence.
3. Update Trello/Company OS state if connector access is available.
4. Close WO-007 through the Company OS gate without merging MAIN/Production unless separately authorized.

PC01 itself is operationally ready. No MAIN/Production action is authorized by this Work Order.
