# TigerIQ — Current State

Date: 2026-09-16
Status: CURRENT — Core/Web live; reduced-shell PC01 control path verified; Chrome maintenance remains gated
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical source / runtime
- GitHub `main` current SHA: `8f2379c1e6766a269caf808a731d5d4b2c1bb5c5` (PR #785 merged); PC01 live workspace remains on the previously verified runtime until a separately authorized release/deploy.
- Core `100.97.23.87:8795`: ONLINE; fresh direct endpoint probe on 2026-09-16 returned `ok=true`, PID `27636`.
- Web Control `100.97.23.87:8796`: ONLINE; fresh direct endpoint probe returned Web + Core `ok=true`; Coding Lane timeout is consistent with intentionally disabled `8797`.
- Chrome Controller remains separately gated; do not restart/reload/close OPEN workers merely for maintenance.
- Core Runtime Updater remains intentionally disabled; no Production release was performed.

## #756 — reduced CMD/PowerShell control path
- #756 is CLOSED/COMPLETED. PR #757 exact reviewed head `52bfb10c0d834c4142dca095f7244e13c4c76883`; exact-head CI run `34847843264` SUCCESS; merged into its parent Chrome Controller branch as `32ab0478cea1e104bda9a638f404af7079ffbb66`, later incorporated through the canonical source line.
- Acceptance evidence: normal controller state, recent log, and process/session inspection moved from repeated PowerShell/polling to Desktop Commander direct URL/file/process/session actions: 0 shell for those normal read-only paths.
- Historical before evidence recorded repeated PowerShell state/log probes around 458–650 ms and polling shells held for ~12–120 s. After evidence recorded direct state ~10 ms, direct log tail ~36 ms, and consolidated runtime snapshot ~80.5 ms.
- Fresh 2026-09-16 verification used direct actions only: Core health PASS, Web health PASS, and Desktop Commander reports `No active sessions`; no shell was spawned for this verification.
- Remaining shell is exception-only: a single bounded mutation POST fallback where no direct remote POST primitive exists, or a bounded consolidated network probe when direct URL access is unavailable. Repeated shell polling is not the normal path.
- Independent NV03 review requirement was resolved before #756 closure; final issue checkpoint records APPROVE and acceptance reached.

## Workforce / Web Control truth
- Registry #335 is canonical for employee identity. `NV02 = ChatGPT Plus`, `NV03 = ChatGPT Go`, `NV04 = Gemini Pro`, `NV10 = Ollama`; NV05 remains retired.
- Web Control remains the single Owner UI and Registry-derived workforce view; Smart Router resources remain separate from employee identity.

## Current active/gated work
- #763 Chrome 3-worker autonomy remains PARTIAL/REAL BLOCKER while Controller is READ_ONLY/paused and workers are not safe to recycle.
- #758 Close & Archive waits on the same safe Chrome maintenance gate.
- #784 source fix is merged/CI PASS, but live updater deployment/enable remains behind the explicit release gate.

## Governance
- Development path remains branch → PR → required checks/review → merge; no direct `main` edits.
- PC01 control preference is endpoint/API → direct remote action → one bounded shell only when unavoidable; no shell polling for health/status when an equivalent endpoint exists.
- Production, paid, credential/security, destructive/irreversible actions require separate authorization.
- Do not claim live/runtime DONE from source/CI alone.

STATE: `CURRENT_20260916_CORE_WEB_PASS_REDUCED_SHELL_CONTROL_VERIFIED_CHROME_GATE_REMAINS`
UI_STATE: `CURRENT_20260915_WEB_CONTROL_CANONICAL_WORKFORCE_PLUS_ROUTING_OVERLAY_LIVE_VERIFIED`
