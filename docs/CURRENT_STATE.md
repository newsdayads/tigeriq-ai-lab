# TigerIQ — Current State

Date: 2026-09-15
Status: CURRENT — NV10 Ollama source merged to main; Web Control Health-parity candidate verified; live Core identity re-check pending
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical runtime
- `main` now includes PR #776 source migration for canonical `NV10 = Ollama`; live Core runtime still requires maintenance verification before claiming the running process has switched identity.
- Core `100.97.23.87:8795`: ONLINE at the latest verified runtime checkpoint.
- Web Control `100.97.23.87:8796`: ONLINE; Owner management UI.
- Coding Lane `8797`: intentionally Disabled; legacy autonomous coding path is not active.
- Core Runtime Updater: intentionally Disabled.
- Desktop Commander Remote and Ollama Runtime: Running at the latest verified runtime checkpoint.
- Engineering path: GitHub branch → PR → required gates → merge; no direct `main` source editing on PC01.

## Web Control Owner UI — #770
- Issue #770: OWNER_DIRECT / P1; PR #771 carries Health-parity + live refresh + system font.
- Candidate was runtime-verified on PC01 without replacing `main`: `/api/status` refresh 2s, visible `LIVE · 2s`, stale threshold 6s.
- UI parity includes KPI cards, provider icon tiles, status/spark, NV/API cards, telemetry/P95 chart, recent jobs, compact events and Local/Cloud/Problem filters.
- Typography uses system UI 14px/1.5; code/log/terminal use SFMono/Consolas/Roboto Mono 13px.
- Desktop 1648x928 and mobile 430x932 visual checks passed; evidence: `evidence/issue-770-web-control-health-parity.md`.
- Owner waived independent review for this iteration; exact-head CI + runtime visual verification are the gate.

## AI Manager / autonomy
- Issue #731 completed through PR #744.
- Manager malformed/trailing/status-invalid JSON uses bounded same-provider retry once, then bounded zero-cost provider failover.
- Manager creates jobs only after a valid decision is parsed; Ollama request timeout is 30s.
- Provider failures use bounded cooldown; NV16 HTTP 402/configuration failures are quarantined from repeated hammering.
- Three real E2E runs passed consecutively without Owner intervention: objective accepted → Manager decomposed → NV19 executed → job DONE → objective COMPLETED.

## Queue truth
- Issue #735 queue hygiene: DONE.
- Runtime verification after #731/#733: active objectives = 0; queued/running/review/waiting_ci jobs = 0.
- No stale active queue item remained; history/evidence preserved.

## Resource truth
- `NV10 = Ollama` is canonical per Registry #335 v49 and PR #776 is merged in source; live runtime identity is not claimed until maintenance verification.
- `NV02 = ChatGPT Plus` is the UI primary executor; it is not the Ollama local/API Core resource.
- NV12 Gemini and NV14 Mistral: provider-side RATE_LIMITED with cooldown/failover; they do not block the pipeline.
- NV16 Hugging Face: provider/configuration error path isolated with cooldown/quarantine.
- NV11/NV13/NV15/NV19 remain usable zero-cost resources when healthy; NV20 remains WAIT_KEY.

## Governance
- Protected-branch checks: CI Verify, Queue Hygiene Verify, Vercel Online Verify.
- Owner authorization 2026-09-15 allows NV01 to merge `main` when exact-head required CI passes and the merge itself cannot trigger Production/paid/credential/security/destructive/irreversible effects.
- Production/live deployment remains a separate risk gate; current `vercel.json` has Git deployment disabled and Core Runtime Updater is disabled.
- Independent review is conditional by risk, not a default dependency.

STATE: `CURRENT_20260915_NV10_SOURCE_MERGED_WEB_CONTROL_HEALTH_PARITY_CANDIDATE_CORE_LIVE_REVERIFY_PENDING`
UI_STATE: `CURRENT_20260915_WEB_CONTROL_HEALTH_PARITY_LIVE_CANDIDATE`
