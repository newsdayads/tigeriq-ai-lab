# OpenClaw PC01 — Guarded Ollama Fallback Design

Date: 2026-09-04
Status: DESIGN READY / RUNTIME BENCHMARK PENDING
Scope: OpenClaw only; shared Ollama remains independently owned by TigerIQ.

## Invariants
- Preserve current primary exactly: `openai/gpt-5.6-sol` with `agentRuntime.id=openclaw`.
- Do not restart/reconfigure/kill Ollama or any protected TigerIQ runtime.
- OpenClaw is only an Ollama client.
- Do not enable any local fallback until one exact local model/context profile passes the runtime gates below.
- Do not combine gateway lifecycle ownership work with model-routing work.
- Apply any eventual model/fallback change by OpenClaw-supported config patch or Control UI hot reload only; no gateway restart unless a separate gate proves it is required and Owner explicitly authorizes it.

## Verified OpenClaw/Ollama behavior
Verified against current OpenClaw and Ollama documentation on 2026-09-04:
- configured default failover uses `agents.defaults.model.fallbacks` after failover-worthy primary/provider exhaustion;
- a user session model selection (`/model`, model picker, `sessions.patch`, etc.) is strict and does **not** use the configured default fallback chain;
- fallback is turn-local and a later turn starts from the selected primary again;
- native Ollama `/api/chat` accepts explicit `options.num_ctx` and top-level `think`/`keep_alive`;
- OpenClaw native Ollama requests can pin context with per-model `params.num_ctx`; `contextWindow` alone is not the safest request-level context control;
- per-model `agents.defaults.models["ollama/<model>"].params.num_ctx` is supported, allowing a narrower change than replacing the whole Ollama provider inventory;
- Ollama `GET /api/ps` exposes loaded model size, `size_vram`, context length and model identity, which is stronger machine-readable offload evidence than relying only on CLI text.

Operational consequence: deliberate fallback validation must use a fresh/default-model session with no user model override. A browser session previously pinned through the model picker can prove direct model operation, but cannot by itself prove configured fallback behavior.

## Read-only gateway audit gate
Before local inference, record without mutation:
- state/action metadata for `TigerIQ OpenClaw Runtime` and `OpenClaw Gateway` Scheduled Tasks if present;
- listener/process ownership for TCP 18789;
- local Control UI HTTP reachability;
- OpenClaw config file existence, timestamp and SHA-256 only (never secrets/config body).

Gateway ownership remains a separate work item. Audit findings do not authorize lifecycle migration.

## Benchmark gate
Phase 1 candidates already observed/expected on PC01:
1. `qwen3:4b`
2. `gemma3:4b`

Contexts: 4096 and 8192. Three runs per model/context. Do not test larger models until both 4B candidates are shown unsuitable.

The benchmark is client-only and must:
- abort before inference if Ollama already has a resident model;
- use an exclusive benchmark lock to avoid duplicate benchmark workers;
- set `think=false` so Qwen-style reasoning does not dominate emergency-fallback latency;
- set `keep_alive=0` so each probe does not intentionally leave its model resident;
- re-check Ollama idle state between runs and stop on detected contention;
- never change OpenClaw config or Ollama service configuration.

Evidence required per run:
- exact response correctness;
- first-content-token latency;
- wall latency;
- prompt/eval token counts and eval tokens/sec;
- `GET /api/ps` runtime model record including `size_vram`, total model size and active context;
- best-effort `ollama ps` text snapshot for operator readability;
- Ollama/llama process working-set sample;
- best-effort Windows dedicated-GPU-memory sample;
- GPU adapter identity/VRAM report;
- evidence that no second resident model was present during the runtime sample.

A benchmark run is PASS only when the response is exact, no timeout/error occurs, the selected model is observed through `/api/ps`, and no model-level contention is detected.

## Candidate selection
A profile is benchmark-stable only after 3/3 PASS at the same model/context.

For the next OpenClaw validation gate, prefer an 8192-token stable profile because OpenClaw AGENTS/tool-policy traffic needs more operational headroom. A 4096-token result remains useful diagnostic evidence but is not automatically considered sufficient for general OpenClaw execution. Selection also considers TTFT, eval throughput and observed VRAM/offload evidence.

No benchmark result automatically enables fallback. If both installed 4B candidates fail, stop and record evidence before considering `qwen3:8b`, `qwen2.5-coder:14b`, or any model download. Do not assume a larger model improves fallback reliability on the RX 5500 XT 4 GB PC01.

## Minimal OpenClaw routing change after benchmark review
Target chain:

`openai/gpt-5.6-sol` -> `ollama/<BENCHMARK_WINNER>`

Keep exactly one local fallback initially.

Preferred conceptual delta — DO NOT APPLY before runtime gates:

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "openai/gpt-5.6-sol",
        fallbacks: ["ollama/<BENCHMARK_WINNER>"]
      },
      models: {
        "ollama/<BENCHMARK_WINNER>": {
          params: {
            num_ctx: <BENCHMARK_WINNING_CONTEXT>,
            thinking: false,
            keep_alive: "<BENCHMARK_DERIVED_KEEP_ALIVE>"
          }
        }
      }
    }
  }
}
```

This deliberately avoids replacing `models.providers.ollama.models` unless a later config audit proves an explicit provider entry is required. Preserve existing Ollama discovery/provider behavior whenever possible.

Provider `timeoutSeconds` is optional and must not be added blindly. If the chosen profile operates within the existing timeout, leave provider timeout unchanged. If a provider-specific timeout is genuinely required, first audit the existing Ollama provider stanza and apply only a merge-safe provider timeout change; never globally inflate the agent timeout to hide an unusably slow local profile.

## Runtime acceptance after benchmark
1. Review benchmark evidence; choose one exact model/context profile only if 3/3 benchmark-stable and operationally usable.
2. Re-audit current OpenAI browser E2E and confirm `TIGERIQ_OPENCLAW_PASS` still works before fallback configuration.
3. Apply only the narrow model/fallback delta by hot reload/config patch; no gateway-owner migration.
4. Start a **new/default-model session** with no model-picker or `/model` override.
5. Run a direct local-model OpenClaw smoke against the selected Ollama model and verify AGENTS/skill/non-interference behavior.
6. Run three consecutive OpenClaw local PASS turns on that exact profile.
7. Deliberately induce a reversible failover-worthy primary failure at the OpenClaw routing layer without disabling network/Ollama or changing shared runtimes; verify the default-model turn advances to the configured Ollama fallback.
8. Restore normal primary availability and verify a later normal default-model turn uses `openai/gpt-5.6-sol` again.
9. Confirm no protected TigerIQ service/task was restarted or reconfigured and no unexpected Ollama ownership/config change occurred.
10. Record diagnostics and update `docs/CURRENT_STATE.md` plus OpenClaw handoff/evidence.

## Fail closed conditions
Do not enable or retain local fallback when any of these occur:
- benchmark <3/3 PASS on the chosen profile;
- repeated timeout or unusable TTFT/wall latency;
- unstable output contract;
- missing `/api/ps` runtime/offload evidence;
- benchmark sees concurrent/resident Ollama contention;
- selected context is insufficient for OpenClaw AGENTS/tool-policy traffic;
- fallback activation requires a shared Ollama service reconfiguration;
- OpenAI primary behavior regresses;
- failover is tested only in a strict user-pinned session rather than a default-model session;
- fallback causes OpenClaw to violate TigerIQ AGENTS/skill/non-interference policy.

## Current status
Design and hardened benchmark harness are ready on the feature branch. Runtime benchmark execution is still pending direct PC01 execution evidence. No fallback is configured and the working OpenAI path remains authoritative.
