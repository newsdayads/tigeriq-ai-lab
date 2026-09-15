# TigerIQ — Current State

Date: 2026-09-15
Status: CURRENT — Core autonomous manager E2E verified; workforce identity renumber source migration in review
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical runtime
- `main` source SHA at #775 branch cut: `33697fdf4b36f0a83d49bd30ce24fc093e3a81fe`.
- Core `100.97.23.87:8795`: ONLINE at the latest verified runtime checkpoint.
- Web Control `100.97.23.87:8796`: ONLINE at the latest verified runtime checkpoint.
- Coding Lane `8797`: intentionally Disabled; legacy autonomous coding path is not active.
- Core Runtime Updater: intentionally Disabled.
- Desktop Commander Remote and Ollama Runtime: Running at the latest verified runtime checkpoint.
- Engineering path: GitHub branch → PR → required gates → merge; no direct `main` source editing on PC01.

## AI Manager / autonomy
- Issue #731 completed through PR #744.
- Manager malformed/trailing/status-invalid JSON is handled by bounded same-provider retry once, then bounded zero-cost provider failover.
- Manager creates jobs only after a valid decision is parsed.
- Ollama request timeout is 30s.
- Provider failures use bounded cooldown; NV16 HTTP 402/configuration failures are quarantined from repeated hammering.
- Three real E2E runs passed consecutively without Owner intervention: objective accepted → Manager decomposed → NV19 executed → job DONE → objective COMPLETED.

## Queue truth
- Issue #735 queue hygiene: DONE.
- Runtime verification after #731/#733: active objectives = 0; queued/running/review/waiting_ci jobs = 0.
- No stale active queue item remained; history/evidence preserved.

## Resource truth
- `NV10 = Ollama` is the canonical local/Core resource identity per Registry #335 v49. Core source migration is tracked by #775; live runtime must be re-verified after an approved merge/deployment before claiming the deployed runtime has switched identity.
- `NV02 = ChatGPT Plus` is the UI primary executor per Registry #335 v49; it is not the Ollama local/API Core resource.
- NV12 Gemini and NV14 Mistral: provider-side RATE_LIMITED with cooldown/failover; they do not block the pipeline.
- NV16 Hugging Face: provider/configuration error path isolated with cooldown/quarantine.
- NV11/NV13/NV15/NV19 remain usable zero-cost resources when healthy; NV20 remains WAIT_KEY.

## Governance
- Required checks remain: CI Verify, Queue Hygiene Verify, Vercel Online Verify.
- No external human GitHub reviewer is required; independent AI review/evidence is sufficient unless Owner changes policy.
- #718 acceptance condition of 3 consecutive real E2E runs is satisfied; final governance/backlog closure is the next checkpoint.

STATE: `CURRENT_20260915_CORE_MANAGER_3X_E2E_PASS_QUEUE_CLEAN_NV10_OLLAMA_SOURCE_MIGRATION_REVIEW`
