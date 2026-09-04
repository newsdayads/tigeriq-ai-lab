# OpenClaw PC01 — Guarded Ollama Fallback Design

Date: 2026-09-04
Status: DESIGN READY / RUNTIME BENCHMARK PENDING
Scope: OpenClaw only; shared Ollama remains independently owned by TigerIQ.

## Invariants
- Preserve current primary exactly: `openai/gpt-5.6-sol` with `agentRuntime.id=openclaw`.
- Do not restart/reconfigure/kill Ollama or any protected TigerIQ runtime.
- OpenClaw is only an Ollama client.
- Do not enable any local fallback until one exact local model/context profile passes three consecutive benchmark runs.
- Do not combine gateway lifecycle ownership work with model-routing work.
- Apply any eventual model/fallback change by OpenClaw-supported config patch or Control UI hot reload only; no gateway restart unless a separate gate proves it is required and Owner explicitly authorizes it.

## Benchmark gate
Phase 1 candidates already installed on PC01:
1. `qwen3:4b`
2. `gemma3:4b`

Contexts: 4096 then 8192. Three runs per model/context. Do not test larger models until both 4B candidates are shown unsuitable.

Evidence required per run:
- exact response correctness;
- first-token latency;
- wall latency;
- prompt/eval token counts and eval tokens/sec;
- `ollama ps` processor/offload line, including CPU/GPU split and context;
- Ollama/llama process working-set sample;
- best-effort Windows dedicated-GPU-memory sample;
- GPU adapter identity/VRAM report.

The benchmark harness aborts before inference when `ollama ps` is non-idle so it does not knowingly contend with another TigerIQ Ollama client.

## Candidate selection
A candidate is eligible only after 3/3 exact-response PASS at the same model/context and no timeout/error. Prefer the smallest context that meets OpenClaw operational needs unless 8192 is equally stable and materially preferable. Latency/offload evidence is part of the selection; a merely correct but consistently timeout-prone CPU-only profile is not acceptable.

If both installed 4B candidates fail, stop and record evidence before considering `qwen3:8b`, `qwen2.5-coder:14b`, or any new model download. Do not assume a larger model improves fallback reliability on the RX 5500 XT 4 GB PC01.

## OpenClaw routing design after benchmark PASS
Target chain:

`openai/gpt-5.6-sol` -> `ollama/<BENCHMARK_WINNER>`

OpenClaw v2026.9.1 uses `agents.defaults.model.fallbacks` as the ordered model fallback chain after provider/profile exhaustion for failover-worthy errors. Keep exactly one local fallback initially; do not create a long unproven chain.

Conceptual config delta only — DO NOT APPLY before benchmark gate:

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "openai/gpt-5.6-sol",
        fallbacks: ["ollama/<BENCHMARK_WINNER>"]
      }
    }
  },
  models: {
    providers: {
      ollama: {
        timeoutSeconds: <BENCHMARK_DERIVED_TIMEOUT>,
        models: [
          {
            id: "<BENCHMARK_WINNER>",
            name: "<BENCHMARK_WINNER>",
            params: {
              num_ctx: <BENCHMARK_WINNING_CONTEXT>,
              keep_alive: "5m"
            }
          }
        ]
      }
    }
  }
}
```

Important: for OpenClaw's native Ollama `/api/chat` path, actual request context should be pinned with per-model `params.num_ctx`; `contextWindow` alone is not treated as the native Ollama request context override. This prevents a repeat of an oversized implicit/default context such as the previously observed 32768 profile.

Provider `timeoutSeconds` must be benchmark-derived and scoped to Ollama; do not globally increase the agent timeout to hide a slow local profile.

## Runtime acceptance after config
1. Re-audit current OpenAI browser E2E and confirm `TIGERIQ_OPENCLAW_PASS` still works before fallback test.
2. Apply only the model/fallback delta by hot reload/config patch; no gateway-owner migration.
3. Run a direct OpenClaw local-model smoke against the exact selected Ollama model and verify AGENTS/skill behavior.
4. Run three consecutive OpenClaw local PASS turns on that exact profile.
5. Deliberately induce a reversible primary-model failure at the OpenClaw routing layer without disabling network/Ollama or changing shared runtimes; verify the turn advances to the selected Ollama fallback.
6. Restore normal primary availability and verify a normal subsequent turn uses `openai/gpt-5.6-sol` again.
7. Confirm no protected TigerIQ service/task was restarted or reconfigured and no unexpected Ollama ownership/config change occurred.
8. Record diagnostics and update `docs/CURRENT_STATE.md` plus OpenClaw handoff/evidence.

## Fail closed conditions
Do not enable or retain local fallback when any of these occur:
- benchmark <3/3 PASS;
- repeated timeout or unusable TTFT/wall latency;
- unstable output contract;
- evidence shows the selected context forces unacceptable CPU-only behavior;
- fallback activation requires a shared Ollama service reconfiguration;
- OpenAI primary behavior regresses;
- fallback causes OpenClaw to violate TigerIQ AGENTS/skill/non-interference policy.

## Current status
Design is ready. Benchmark execution is still pending physical PC01 execution evidence. No fallback is configured yet and the working OpenAI path remains authoritative.