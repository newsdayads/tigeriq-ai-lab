# TigerIQ OpenClaw PC01 — Handoff / Current State

Date: 2026-09-04
Status: ACTIVE — chat path working; hybrid/offline resilience not finished
Owner: anh Sơn
Chief of Staff: Vy
OpenClaw role: PC01 Operations / Execution Worker

## Objective
Configure OpenClaw on PC01 as a safe TigerIQ execution worker that does not replace Vy, does not interfere with other AI runtimes, can be operated locally without token friction, follows TigerIQ AGENTS/skill rules, and ultimately has a reliable cloud + local fallback model path.

## Protected PC01 runtimes
Do not restart/reconfigure/kill without explicit authorization: PostgreSQL 5432; TigerIQ Command Center 8787; TigerIQ Workforce Controller 8790; Ollama 11434; Planner; Worker; Mission Orchestrator; Autonomy Supervisor; other AI runtimes already operating on PC01. OpenClaw may use Ollama only as a client.

## Current OpenClaw baseline
- OpenClaw 2026.9.1.
- Control UI: `http://127.0.0.1:18789/`.
- Gateway bind: loopback only.
- No-login browser flow verified.
- State/config: `D:\TigerIQ\OpenClaw`; config `D:\TigerIQ\OpenClaw\openclaw.json`.
- Workspace: `D:\TigerIQ-OpenClaw\workspace`.
- Agent: `main`.
- Workspace skill `tigeriq-pc01-operator` discovered/enabled; skills count observed 55 with one workspace skill.
- TigerIQ-optimized `AGENTS.md` installed.
- Browser policy test confirmed OpenClaw identifies itself as PC01 Operations / Execution Worker, not Chief of Staff, and recognizes protected PC01 services.

## Model/runtime — current working state
- Primary: `openai/gpt-5.6-sol`.
- Model-scoped runtime: `openclaw`.
- Fallbacks: none.
- Auth: existing OpenAI OAuth/Plus account.
- Browser E2E PASS: `TIGERIQ_OPENCLAW_PASS`.
- AGENTS/skill audit PASS after runtime fix.

Limitation: this is ONLINE and quota-dependent. If OpenAI quota/rate-limit/network blocks the provider, OpenClaw currently has no tested fallback. This is working interim state, not final resilient architecture.

## Local Ollama root cause
Read-only audit on 2026-09-04 observed:
- `ollama ps`: `qwen3:4b`.
- loaded size about 9.5 GB.
- processor: 100% CPU.
- context: 32768.
- GPU detected: Radeon RX 5500 XT 4 GB.
- OpenClaw request timed out while local inference remained CPU-bound.

Do not globally reconfigure or restart Ollama to make OpenClaw pass; Ollama is shared by other TigerIQ runtimes. Local fallback must not be enabled until an isolated benchmark proves a stable model/context/runtime profile.

## Config defects found and fixed
### Workspace alias
Old sessions/state had stale workspace alias references. Canonical workspace is now `D:\TigerIQ-OpenClaw\workspace`; config audit confirmed it resolves as a normal directory. `openclaw doctor --fix` completed after releasing the active gateway lifecycle lock. Do not resume stale failed sessions; use new sessions.

### OpenAI runtime
`openai/gpt-5.6-sol` initially auto-selected Codex harness while Codex plugin was disabled, producing `owner-plugin-not-activatable`. Fixed successfully with model-scoped `agentRuntime.id = openclaw`; OpenClaw applied this config patch via hot reload without gateway restart.

### Other config inconsistencies
- `ollama/qwen3:4b` existed as default but was absent from explicit `modelPolicy.allow`; this was a config inconsistency, not the main timeout cause.
- OpenClaw config lists `ollama/gemma4`, while observed Ollama inventory includes `gemma3:4b`; include this in later local-model cleanup audit, not as an immediate mutation.

## Gateway/service ownership history
Two Windows lifecycle mechanisms have existed: custom `TigerIQ OpenClaw Runtime` Scheduled Task and official `OpenClaw Gateway` Scheduled Task. Attempts to normalize ownership to the official task did not reach a healthy gateway and were rolled back. Do not repeat those migration scripts automatically. Keep the currently working launcher untouched until a dedicated gateway-owner audit is performed. Do not combine gateway-owner migration with model changes. Prefer browser/hot reload for settings that support it.

## Failed/reverted attempts — do not re-run as current runbooks
- `TigerIQ_OpenClaw_Model_Isolation_Fix.ps1`
- `TigerIQ_OpenClaw_FINAL_FIX.cmd`
- `TigerIQ_OpenClaw_FINAL_SERVICE_FIX.cmd`
- `TigerIQ_OpenClaw_RECOVERY_V2.cmd`

Failure causes included gateway lifecycle contention, early script exit before evidence, incorrect reliance on Windows/native CLI exit code, official Gateway task not becoming healthy, and combining service-owner migration with model changes. Rollback paths completed where reported.

## Successful artifacts/changes
- `AGENTS_TIGERIQ_OPENCLAW_OPTIMIZED_v1.1.md` installed as workspace policy.
- `tigeriq-pc01-operator` workspace skill discovered and enabled.
- `TigerIQ_OpenClaw_ROOT_CAUSE_AUDIT.ps1` produced useful read-only evidence.
- `TigerIQ_OpenClaw_RUNTIME_FIX.cmd` successfully patched `openai/gpt-5.6-sol.agentRuntime.id = openclaw`.
- Browser model selection to GPT-5.6 Sol hot-reloaded successfully.
- Browser E2E model test PASS.
- Browser AGENTS/skill policy test PASS.

## PC01 evidence files
- `D:\TigerIQ\OpenClaw\diagnostics\OPENCLAW_ROOT_CAUSE_20260904-175406.txt`
- `D:\TigerIQ\OpenClaw\diagnostics\OPENCLAW_FINAL_FIX_20260904-181233.txt`
- `D:\TigerIQ\OpenClaw\diagnostics\OPENCLAW_SERVICE_MODEL_FINAL_20260904-181850.txt`
- `D:\TigerIQ\OpenClaw\diagnostics\OPENCLAW_RECOVERY_V2_20260904-182155.txt`
- Timestamped `openclaw.json` backups under `D:\TigerIQ\OpenClaw`.

## Mandatory lessons
- AUDIT before architecture changes.
- One problem per change: model routing, gateway lifecycle, workspace state separately.
- Prefer browser/hot reload where supported.
- On Windows, verify actual state; do not trust native CLI ExitCode alone.
- For structured config, use `config patch --file` or browser; avoid inline JSON quoting.
- Never kill/reconfigure shared Ollama to make OpenClaw pass.
- Do not resume stale failed OpenClaw sessions after gateway/workspace recovery.
- Long code/text instructions to anh Sơn should be one line where practical, or one file with one action.

## NEXT P0 — exact continuation point
Goal: make OpenClaw resilient without depending entirely on OpenAI quota.

Do not change the current working cloud path yet.

Next execution cycle:
1. AUDIT current gateway/task owner only; no mutation.
2. Run an isolated LOCAL MODEL benchmark without changing shared Ollama service config.
3. Measure GPU/Vulkan offload if any, first-token latency/tokens-per-second, RAM/VRAM use, stable context size, and suitable installed model candidates.
4. Select one proven local model/runtime profile.
5. Require 3 consecutive local PASS runs before configuring fallback.
6. Test failover deliberately while preserving the working OpenAI path.
7. Record evidence and update `docs/CURRENT_STATE.md`.

Target final architecture: OpenClaw default cloud model -> tested local Ollama fallback -> no interference with shared TigerIQ runtimes.

## NEW CHAT resume rule
When a new TigerIQ AI Lab chat receives `1` or `2`, treat this OpenClaw item as ACTIVE P0 until hybrid/offline resilience is verified. Do not ask anh Sơn to restate this history. Read `docs/CURRENT_STATE.md` and this handoff first, then continue from NEXT P0.
