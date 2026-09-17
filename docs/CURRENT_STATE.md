# TigerIQ — Current State

Date: 2026-09-17
Status: CURRENT — Chrome autonomy exactly-once E2E + Astra handoff verified; Worker Utility UI lane active
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical source / runtime
- GitHub `main` remains canonical. Engineering changes go `branch → PR → required checks → merge`; no direct `main`.
- #763 Chrome autonomy hardening is source/runtime verified after PR #798 and PR #799 merged.
- Live Chrome Controller artifact on PC01 is `Current-v117-763-49524aa`; reboot/startup script `D:\TigerIQ\Apps\ChromeController\Runtime\Start-Workspace.ps1` points to that exact artifact and starts fail-safe in `READ_ONLY`.
- Controller `127.0.0.1:8798` and Direct CDP Bridge `127.0.0.1:8799` are ONLINE; existing Chrome sessions are preserved.
- UI Autopilot Snapshot Adapter `127.0.0.1:8794` serves snapshot v2. Latest verified snapshot remains `github-ui-v2:GH-797:DONE:none:none`.
- TigerIQ Core `100.97.23.87:8795` is ONLINE; latest live verification returned `ok=true`, PID `11892`.
- Web Control `100.97.23.87:8796` is ONLINE and reports Core healthy. Coding Lane `8797` remains intentionally disabled.
- Core Runtime Updater remains intentionally disabled.

## #763 — Chrome autonomy final truth
- PR #798 merged: `AUTO_CONTINUE` keeps the current worker chat (`navigate=false`).
- PR #799 merged: explicit known non-delivery can take one bounded safe retry; ambiguous delivery remains fail-closed.
- Live canary #796 completed exactly once with one `CANARY_A_EXECUTED` comment.
- Completion Watcher consumed fresh external GitHub evidence with `jobId`, `completedAt` and `completionRevision` from snapshot v2.
- Live canary #797 then completed exactly once with one `CANARY_B_EXECUTED` comment.
- Final autopilot evidence: `lastDispatchedJobId=GH-797`, `lastCompletedJobId=GH-797`, no pending/uncertain job, next job null.
- #763 is CLOSED/COMPLETED.

## Astra dispatch / handoff truth
- #787 is CLOSED/COMPLETED.
- Direct PC01 path is verified with Codex CLI and model `gpt-6-astra`; Astra remains an on-demand resource of NV02, not a separate employee.
- Usage/quota state is `UNKNOWN` because no direct measurement source is installed/available; no percentage is inferred.
- OFF-MAIN smoke branch `astra/issue-787-offmain-smoke-20260917` is exactly one commit ahead of `main` and changes exactly one doc file; no direct-main mutation.
- Astra session `01a0af65-f174-79b2-b802-2c53b216537b` resumed successfully with `ASTRA_787_RESUME_OK`.
- Controlled timeout/handoff verification preserved the durable branch checkpoint with no duplicate mutation.
- Cloudflare MCP OAuth `AuthRequired` can appear during Codex startup; TigerIQ does not bypass it. Project exec-policy can force read-only, so the verified fallback is Astra read-only output → durable OFF-MAIN handoff → Vy/GitHub application.

## Chrome workforce live truth
- Canonical UI workers remain `NV02 | NV03 | NV04`.
- Current Controller is fail-safe `READ_ONLY`; workers remain enabled and attached to existing windows.
- Latest live heartbeat: NV02/NV03/NV04 all OPEN, `uiReady=true`, `authRequired=false`, `securityBlock=null`.
- NV02 is currently `SUBMITTED/uiBusy=true` on #802; NV03/NV04 remain idle/ready.
- Repeated command `00` does not create a duplicate NV02 mutation lane while #802 owns `apps/worker-utility/**`.

## Worker Utility / active work
- #793 Worker Utility V1 is CLOSED/COMPLETED and remains the canonical APP for controlling NV02/NV03/NV04; source is `apps/worker-utility/**`.
- #801 Source of Truth reconciliation is CLOSED/COMPLETED.
- #802 remains the active independent NV02 lane for Worker Utility UI/UX. It owns `apps/worker-utility/**` and directly related tests/UI artefacts.
- Command `00` remains the dual-lane orchestration alias from Interaction #504 v27: Vy continues the highest-priority safe lane while ChatGPT Plus (NV02) receives one independent safe lane when ownership allows it.

## Workforce / identity
- Registry #335 remains authoritative for employee identity/capability.
- `NV02 = ChatGPT Plus` is the primary UI executor; `NV03 = ChatGPT Go` is independent review/support; `NV04 = Gemini Pro` is deep research/cross-check; `NV10 = Ollama` is local/Core AI.
- `NV05` and command `5` remain retired. `GPT-6 Astra` remains an on-demand high-tier resource of NV02, not a separate employee.

## Governance
- Interaction #504 v27 is current and contains the Owner override for command `00` dual-lane orchestration.
- Registry #335 v50 remains current.
- Production release, paid service, credential/security mutation and destructive/irreversible actions remain separate authorization gates.

STATE: `CURRENT_20260917_763_787_801_DONE_802_ACTIVE`
UI_STATE: `CURRENT_20260917_WORKER_UTILITY_CANONICAL_NV02_UI_LANE_ACTIVE`
