# WO-007 Gate Evidence — 2026-08-29

Status: PASS — repository + physical PC01 E2E + watchdog self-heal

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
- Physical Worker/Watchdog self-heal restores exactly one Worker instance after the Worker process is deliberately killed.

## Repository evidence
- Physical-E2E source head: `375e305b3c44f25ec076d9d2b4ada0d2c36f0fe6`.
- GitHub Actions CI #67 / run `33250789420`: PASS.
- CI conclusion: success on the physical-E2E source head.

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
- Evidence commit SHA: `375e305b3c44f25ec076d9d2b4ada0d2c36f0fe6`.
- REVIEW: PASS by independent reviewer identity `pc01-reviewer-e2e`.
- DONE: PASS by independent judge identity `pc01-judge-e2e`.

## Physical watchdog recovery evidence
A deliberate Worker kill was used to exercise self-heal. The first recovery attempt exposed a defect: the Scheduled Task could remain logically running after the Python worker process had exited, so the old watchdog did not recover it. The watchdog was hardened locally to check the real `worker.py` process, suppress duplicate workers, reset/start the Worker Scheduled Task when no worker process exists, and run every minute.

Final observed recovery result:
- Baseline Worker instances: exactly `1`.
- Worker deliberately killed.
- Watchdog recovery: exactly `1` Worker restored.
- Post-recovery Ollama response: `TIGERIQ_AUTO_MODE_PASS`.
- `TigerIQ Worker`: `Running`.
- `TigerIQ Worker Watchdog`: `Ready` with recurring trigger configured.
- Final console gate: `[100%] TIGERIQ PC01 AUTO MODE READY`.

## Security/operations
- Ollama remains local/loopback for Company OS fallback; no public exposure was authorized.
- No token/secret evidence was committed.
- MAIN/Production remain untouched by WO-007.

## Gate conclusion
The physical PC01 gates are complete: cloud-outage → Ollama fallback, durable Work Order recovery, independent review/judge, and Worker watchdog self-heal all PASS. PC01 is operationally ready as the local AI execution fallback. Repository documentation reconciliation is recorded on the WO branch; any merge into MAIN remains a separate Company OS gate requiring the applicable authorization.
