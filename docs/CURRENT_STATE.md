# TigerIQ — Current State

Date: 2026-09-15
Status: CURRENT — Core autonomous manager E2E verified; Web Control Health-parity candidate live
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical runtime
- `main` source SHA at this snapshot: `33697fdf4b36f0a83d49bd30ce24fc093e3a81fe`.
- Core `100.97.23.87:8795`: ONLINE; remains backend/API truth and temporary API Health reference UI.
- Web Control `100.97.23.87:8796`: ONLINE; Owner management UI.
- Coding Lane `8797`: intentionally Disabled; legacy autonomous coding path is not active.
- Core Runtime Updater: intentionally Disabled.
- Desktop Commander Remote and Ollama Runtime: Running.
- Engineering path: GitHub branch → PR → required gates → merge; no direct `main` source editing on PC01.

## Web Control Owner UI — #770
- Issue #770 - Đồng bộ icon/CSS API Health + live refresh + font hệ thống: OWNER_DIRECT / P1.
- PR #771 - Parity API Health + live refresh + system font: OPEN on branch `nv05/issue-767-health-parity-font-refresh`; not merged at this snapshot.
- Candidate source was loaded to PC01 Web Control for Owner visual acceptance without replacing `main`.
- Runtime candidate SHA at final visual verification: `fe757813d8f33640071eceeee468506813b212d4`.
- Web Control refreshes `/api/status` every 2 seconds and exposes a visible `LIVE · 2s` freshness indicator; stale data is flagged after 6 seconds.
- API Health visual/function pattern is now represented in Web Control: 8 KPI cards, provider icon tiles, status/spark, rich NV/API cards, telemetry/P95 chart, recent jobs, compact events and Local/Cloud/Problem filters.
- Typography: system UI stack at 14px/1.5 with antialiasing; code/log/terminal use SFMono/Consolas/Roboto Mono stack at 13px.
- Desktop 1648x928 and mobile 430x932 visual checks passed after responsive fixes; evidence: `evidence/issue-770-web-control-health-parity.md`.
- Owner explicitly waived independent review for this iteration; CI exact-head + runtime visual verification are the completion gates.

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
- NV02 Ollama: ONLINE/IDLE after live probe.
- NV12 Gemini and NV14 Mistral: provider-side RATE_LIMITED with cooldown/failover; they do not block the pipeline.
- NV16 Hugging Face: provider/configuration error path isolated with cooldown/quarantine.
- NV11/NV13/NV15/NV19 remain usable zero-cost resources when healthy; NV20 remains WAIT_KEY.

## Governance
- Required protected-branch checks remain: CI Verify, Queue Hygiene Verify, Vercel Online Verify.
- No external human GitHub reviewer is required; Owner may waive independent AI review for an explicit iteration as in #770.
- #718 acceptance condition of 3 consecutive real E2E runs is satisfied; final governance/backlog closure remains a separate checkpoint.

STATE: `CURRENT_20260914_CORE_MANAGER_3X_E2E_PASS_QUEUE_CLEAN`
UI_STATE: `CURRENT_20260915_WEB_CONTROL_HEALTH_PARITY_LIVE_CANDIDATE`
