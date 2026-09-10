# NV02 Groq Worker

Runtime adapter for `NV02 / Khoa` to consume Controller V1 Work Orders and execute AI prompts through Groq Free tier.

## Safety invariants

- Groq is allowed only when the local proof says `plan=Free`, `priceUsd=0`, `ownerConfirmed=true`, `paidFallbackAllowed=false`.
- API key remains DPAPI-protected at rest and is decrypted only inside the short-lived PowerShell provider process.
- Secrets are never written to worker logs or evidence.
- Worker identity is separate: `NV02` / `DEV-PC01-NV02` / `BIND-PC01-NV02`.
- Concurrency is 1 until broader workload acceptance is complete.
- No MAIN/Production mutation is performed by this adapter.

## Runtime path

`D:\TigerIQ\Runtime\nv02-worker`

## Acceptance

Controller-targeted Groq E2E requires: queued job, active lease observed, result employee `NV02`, route/provider `groq`, model `openai/gpt-oss-120b`, terminal `done`, and JSON evidence.

Acceptance runner `run-acceptance-517.ps1` verifies three distinct Work Orders, Controller idempotency, bounded Groq retries, and independent assurance:

- Executor: `NV02 / groq:openai/gpt-oss-120b`
- Reviewer: `ollama:gemma3:4b`
- Judge: `ollama:qwen3:8b`
- Required terminal state: `done`
- Required JSON evidence per job contains executor + reviewer + judge assurance

The acceptance runner is diagnostic/verification tooling; normal NV02 operation is automatic through the Controller queue and does not require Owner CMD/PowerShell.
