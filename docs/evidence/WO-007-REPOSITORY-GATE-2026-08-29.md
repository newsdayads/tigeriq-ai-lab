# WO-007 Gate Evidence — 2026-08-29

Status: PASS — repository + physical PC01 E2E

## Scope verified
- Model Router cloud/provider failover with circuit breaker.
- Ollama OpenAI-compatible adapter.
- Durable Work Order worker composition root.
- Resume/recovery of a Work Order through a reconstructed durable control plane.
- Evidence recording before gate decisions.
- Independent coder/reviewer/judge identities.
- REVIEW then DONE gate flow.
- Fail-closed behavior when all providers fail.
- Simulated cloud outage routes execution to physical PC01 Ollama.
- Passing execution evidence requires a real git commit SHA.

## Repository evidence
- Physical-E2E source head: `d579b79138b752ed30fad878bda249e2f096aede`.
- GitHub Actions CI #65 / run `33250476883`: PASS.
- CI passed Install, Typecheck, Unit tests, Playwright smoke and Build.

## Physical PC01 E2E evidence
Executed by Owner on PC01 from branch `wo007/pc-local-ai-worker` using `scripts/pc-worker/e2e-wo007.ps1` with model `qwen2.5-coder:14b`.

Observed result:
- Local target provider: `ollama`.
- Local model: `qwen2.5-coder:14b`.
- Local route result: PASS (`ok: true`).
- Work Order status: `verified`.
- Recovered status after durable control-plane reconstruction: `verified`.
- Model response: `TIGERIQ_WO007_LOCAL_FALLBACK_OK`.
- Execution evidence command: `model-router:ollama/qwen2.5-coder:14b`.
- Execution evidence exit code: `0`; status: `pass`.
- Evidence commit SHA: `d579b79138b752ed30fad878bda249e2f096aede`.
- REVIEW: PASS by independent reviewer identity `pc01-reviewer-e2e`.
- DONE: PASS by independent judge identity `pc01-judge-e2e`.
- Worker/Watchdog Scheduled Task check reached the E2E runner before build/execution; PC01 bootstrap evidence also records both tasks as configured.

## Gate conclusion
WO-007 acceptance evidence is sufficient for the local fallback and durable recovery objective demonstrated by the committed E2E harness and physical-PC run. This evidence does not authorize a MAIN merge or Production mutation. Release/stack integration remains a separate Company OS gate.
