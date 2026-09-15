# TigerIQ — Current State

Date: 2026-09-15
Status: CURRENT — NV10 Ollama source merged; Web Control Health-parity merged; canonical workforce candidate verified; live Core identity re-check pending
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical runtime
- `main` includes PR #776 canonical `NV10 = Ollama`, PR #750 Chrome Controller base, PR #766 UI Autopilot Snapshot Adapter, and PR #771 Web Control Health-parity.
- Core `100.97.23.87:8795`: ONLINE at the latest verified runtime checkpoint; live NV10 identity still requires maintenance verification.
- Web Control `100.97.23.87:8796`: ONLINE; single Owner management UI.
- Coding Lane `8797` and Core Runtime Updater remain intentionally disabled.
- Desktop Commander Remote and Ollama Runtime: Running at the latest verified runtime checkpoint.
- Engineering path: GitHub branch → PR → required gates → merge; Production/live deployment is separate.

## Web Control Owner UI — #770 + #772
- PR #771 Health-parity + live refresh + system font is merged to `main` after exact-head CI and runtime visual verification.
- #772 / PR #774 adds canonical workforce cards NV01–NV20 and is the current candidate pending merge.
- Web Control refreshes `/api/status` every 2 seconds, exposes `LIVE · 2s`, and flags stale data after 6 seconds.
- API Health visual/function pattern is represented in Web Control: KPI cards, provider/API health, telemetry/P95 chart, recent jobs, compact events and Local/Cloud/Problem filters.
- Typography uses `"Segoe UI", Roboto, Helvetica, Arial, sans-serif` at 14px/1.5; code/log/terminal use SFMono/Consolas/Roboto Mono 13px.

## Canonical workforce cards — #772 verified
- Identity source is Registry #335; runtime/API data only enriches canonical employees.
- Runtime candidate verified `workforce=20`, `source=registry-335-live`, `version=49`.
- All slots `NV01` through `NV20` render; retired/unassigned slots remain visible with truthful state rather than fake OFFLINE.
- Current identity projection follows Registry v49: `NV02 = ChatGPT Plus`; `NV10 = Ollama`; legacy live Core `NV02/Ollama` may be projected to `NV10/Ollama` in UI until live Core maintenance verification confirms migration.
- Card strip is exactly two fixed rows with horizontal scrolling; technical model/latency/success/error/cooldown details remain available by tooltip.
- Runtime DOM evidence at 1920×1080: 20 cards; rows `82px 82px`; horizontal scroll true; live refresh present.
- Evidence: `evidence/issue-772-web-control-workforce-cards.md`.

## AI Manager / autonomy
- #731 completed through PR #744; bounded retry/failover and valid-decision-before-job rules remain active.
- Ollama request timeout is 30s; provider failures use bounded cooldown/quarantine.
- Three real E2E runs passed consecutively without Owner intervention.

## Queue truth
- #735 queue hygiene: DONE.
- Latest verified active objectives = 0; queued/running/review/waiting_ci jobs = 0.
- No stale active queue item remained; history/evidence preserved.

## Resource truth
- `NV10 = Ollama` is canonical per Registry #335 v49 and merged source; live runtime identity is not claimed until maintenance verification.
- `NV02 = ChatGPT Plus` is the UI primary executor, not the Ollama Core resource.
- NV12/NV14 rate-limit paths and NV16 provider/configuration isolation remain bounded; NV11/NV13/NV15/NV19 remain usable zero-cost resources when healthy; NV20 remains WAIT_KEY.

## Governance
- Protected-branch checks: CI Verify, Queue Hygiene Verify, Vercel Online Verify.
- Owner authorization 2026-09-15 allows NV01 to merge `main` when exact-head required checks pass and merge cannot trigger Production/paid/credential/security/destructive/irreversible effects.
- `vercel.json` Git deployment and Core Runtime Updater are disabled, so source merge does not itself deploy live.
- Production/live deployment remains a separate risk gate; independent review is conditional by risk, not a default dependency.

STATE: `CURRENT_20260915_NV10_SOURCE_MERGED_WEB_PARITY_MERGED_WORKFORCE20_CANDIDATE_CORE_LIVE_REVERIFY_PENDING`
UI_STATE: `CURRENT_20260915_WEB_CONTROL_WORKFORCE_20_TWO_ROWS_LIVE_CANDIDATE`
