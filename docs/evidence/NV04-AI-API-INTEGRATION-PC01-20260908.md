# NV04 — AI/API Integration PC01 Evidence — 2026-09-08

## Scope
Khải/NV04 specialized session activated by Owner for #392 -> #110/#125/#133. OFF-MAIN only. No paid provider, credential/security widening, MAIN/Production, reboot or irreversible action.

## Canonical inputs
- #110 / PR #111 `wo043/ai-coordinator` exact `b58a304caac12d8352025bcaaa711b1ff48766da` — repository + independent review PASS.
- #125 / PR #127 `wo047/api-first-inference-gateway` exact `181e3f5262778bccd15692685a70bade946ee747` — DEV_GATE_PASS, optional `pc01-server` adapter.
- #133 / PR #134 `wo048/multi-ai-subscription-orchestration` exact `56158cfa85558f6ecd7a3c15dbf3bf95c82df8c9` — crash-safe JOB-001 DEV_GATE_PASS.

## Integration worktree
- Branch: `nv04/ai-api-runtime-integration-20260908`.
- Base: PR #127 head.
- PR #134 merged cleanly into the isolated worktree before commit.
- Shared runtime/source worktrees were not modified.

## Finding + fix
PC01 Windows PowerShell 5.1 returned blank `ExitCode` from the prior `Start-Process -PassThru` pattern used by `probe-multi-ai.ps1`, which falsely marked working Git/Ollama binaries as version errors and prevented Ollama live probing.

Fix: `Invoke-External` now uses `System.Diagnostics.Process` with redirected output, bounded timeout and explicit numeric exit code capture. Self-test now covers both zero and non-zero exit-code capture.

## Deterministic verification
- `git diff --check`: PASS.
- AI zero-cost policy test: PASS.
- Provider scheduler lease/dedupe test: PASS.
- JOB-001 crash/restart/tamper orchestration test: PASS.
- Multi-AI probe self-test: PASS, including `exitCodeCapture=PASS`.
- TypeScript typecheck: PASS.
- Targeted Vitest: 7 files / 44 tests PASS covering AI Coordinator, AI Runtime V1, Inference Gateway, device E2E, idempotency identity, provider policy and provider mesh.
- Full Vitest regression: 28 files / 126 tests PASS.
- TypeScript build: PASS.

## PC01 live provider readiness
- Ollama 0.33.2: READY.
- Models present: `qwen3:4b`, `gemma3:4b`, `qwen3:8b`, `qwen2.5-coder:14b`.
- Gemini CLI: not installed.
- Claude CLI: not installed.
- OpenRouter: free-route implementation present but `OPENROUTER_API_KEY` not configured in the runtime environment.
- No Gemini/Anthropic/Groq API key was detected in Process/User/Machine environment scopes during the sanitized presence audit.

## Live JOB-001 — local Multi-AI
Real PC01 orchestration completed with three distinct provider/model backend identities, one attempt each:
1. executor -> `ollama:qwen3:4b` -> result SHA-256 `7d9f9b71e1b6a06bd16403bad04453bba7de7b30c274751c12c7a83f9faf1009`.
2. reviewer -> `ollama:gemma3:4b` -> result SHA-256 `3e3b96450efd6310cfaea85d319df53250741df404b5d498d83225c6c226220e`.
3. judge -> `ollama:qwen3:8b` -> result SHA-256 `585f340624ca966074980d79474fb3633b4ad72db39b3ced989cdbd38a1275ab`.

Canonical machine evidence: `D:\TigerIQ\Evidence\AI-API\JOB-001-NV04-LIVE-20260908T071310Z-evidence.json`.
Final state: `COMPLETED`.

## Truth boundary / remaining work
Local Multi-AI orchestration is now physically proven on PC01. Cloud API integration is NOT yet proven because no eligible cloud credential/auth route is currently available on PC01. Next work is to preserve zero-cost fail-closed policy, complete an eligible cloud provider route when credentials/auth are available, then run mixed local/cloud JOB-001 E2E and publish evidence. PC01 reboot recovery and Web Control are separate gates; they do not block OFF-MAIN AI/API integration work.