# PC01 GitHub Release Channel — 2026-09-09

Status: PARTIAL PASS — deployment path fixed; legacy job path still pending.

## Verified
- PC01 GitHub service credential accesses `newsdayads/tigeriq-ai-lab`; no secret exposed.
- Root cause for repeated manual CMD/PowerShell: GitHub source still contained stale `F:\TigerIQ` paths while live PC01 uses `D:\TigerIQ`; updater task was disabled; runtime branches/versions had drifted.
- Release branch: `vy/web-v5-release-channel-20260909`.
- Release commit: `21445a147e4351a43682afe46edd9667cfd0cd56`.
- GitHub release workflow completed successfully, run `34269345724`.
- PC01 installed immutable release `21445a147e4351a43682afe46edd9667cfd0cd56` using `artifact-pull-atomic-switch` with `gitUsed=false`.
- Previous release retained for rollback: `d0fa503c655bb54505015bc634af53edaceb13c5`.
- Command Center health returned HTTP 200 after activation.
- `TigerIQ Command Center Updater V3` is enabled and repeats every 2 minutes; verification run returned `NO_CHANGE`, exit result `0`.
- MAIN/Production not touched.

## Remaining P0
- Two execution paths still coexist in Web Control.
- Typed execution is configured and exposes bounded capabilities.
- Legacy free-form `/jobs` / system-action path can still route through the older GitHub queue; observed `ollama.status` Work Order remained at `approved`.
- Consolidate Web Control onto the typed/controller execution path and remove/disable the obsolete queue path only after regression/E2E evidence.
