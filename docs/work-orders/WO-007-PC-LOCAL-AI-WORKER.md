# WO-007 — PC Local AI Execution Worker

Priority: P0
Status: IN PROGRESS — REPOSITORY GATES ACTIVE; PHYSICAL-PC E2E EVIDENCE REMAINS
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

## PC01 evidence supplied by Owner
- PC01 bootstrap reports `AUTO MODE READY 100%`.
- Ollama model: `qwen2.5-coder:14b`.
- Worker and Watchdog are installed as Windows Scheduled Tasks.
- GitHub CLI is installed.
- Tailscale address: `100.97.23.87`.

These are accepted as Owner-supplied operational evidence, but they do not replace repository CI or the final physical-PC end-to-end evidence required by this Work Order.

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

## Repository evidence
- Draft PR #18; MAIN/Production remain untouched.
- Composition commit: `17ca2c28a0838b585d80bbfc5e381ffa3a1ef0cd`.
- Worker test commit: `fb9ce67256f54d560733843c17aadf0292331a9c`.
- CI run `33250229767` validates the latest worker head; Install, Typecheck, Unit tests and Playwright smoke passed before the documentation refresh. Final Build/conclusion must be checked on the latest resulting head before repository verification is claimed.

## Remaining gate
1. Confirm latest GitHub CI PASS after this documentation refresh.
2. Capture/reconcile physical-PC audit and Ollama smoke output without secrets.
3. Run one real PC01 sample Work Order with cloud providers deliberately unavailable and record route attempt → Ollama execution → evidence → independent review → judge/DONE.
4. Restart Worker/Watchdog and prove durable Work Order recovery from persisted state.
5. Update CURRENT_STATE/Trello/evidence with the final hashes/results.

Do not mark DONE until all five are evidenced. No MAIN/Production action is authorized by this Work Order.
