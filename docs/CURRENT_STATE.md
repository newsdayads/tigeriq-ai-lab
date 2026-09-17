# TigerIQ — Current State

Date: 2026-09-17
Status: CURRENT — Chrome autonomy exactly-once E2E verified; Worker Utility UI lane active
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical source / runtime
- GitHub `main` remains canonical. Engineering changes go `branch → PR → required checks → merge`; no direct `main`.
- #763 Chrome autonomy hardening is source/runtime verified after PR #798 and PR #799 merged.
- Live Chrome Controller artifact on PC01 is `Current-v117-763-49524aa`; reboot/startup script `D:\TigerIQ\Apps\ChromeController\Runtime\Start-Workspace.ps1` points to that exact artifact and starts fail-safe in `READ_ONLY`.
- Controller `127.0.0.1:8798` and Direct CDP Bridge `127.0.0.1:8799` are ONLINE after safe task recovery on 2026-09-17; existing Chrome sessions were preserved.
- UI Autopilot Snapshot Adapter `127.0.0.1:8794` serves snapshot v2. Latest verified snapshot remains `github-ui-v2:GH-797:DONE:none:none`.
- TigerIQ Core `100.97.23.87:8795` is ONLINE; latest live verification returned `ok=true`, PID `11892`.
- Web Control `100.97.23.87:8796` is ONLINE and reports Core healthy. Its Coding Lane probe is expected to time out because Coding Lane `8797` remains intentionally disabled.
- Scheduled task `TigerIQ Coding Lane 24x7` is disabled and `127.0.0.1:8797` refuses connections, matching policy.
- Core Runtime Updater remains intentionally disabled.
- No Production release, paid action, credential change, destructive action or irreversible action was performed by this reconciliation.

## #763 — Chrome autonomy final truth
- PR #798 merged: `AUTO_CONTINUE` keeps the current worker chat (`navigate=false`), preventing the `COMPOSER_NOT_FOUND` failure caused by navigating away before submission.
- PR #799 merged: explicit known non-delivery can take one bounded safe retry; ambiguous delivery remains fail-closed; retry-state transition failure also fail-closes.
- Live canary #796 completed exactly once with one `CANARY_A_EXECUTED` comment and issue closed completed.
- Completion Watcher consumed fresh external GitHub evidence with `jobId`, `completedAt` and `completionRevision` from snapshot v2.
- Live canary #797 then completed exactly once with one `CANARY_B_EXECUTED` comment and issue closed completed.
- Final autopilot evidence: `lastDispatchedJobId=GH-797`, `lastCompletedJobId=GH-797`, evidence points to #797, no pending/uncertain job, next job null.
- Durable lease/takeover, fresh completion-evidence correlation, fail-closed auth/re-auth/CAPTCHA/rate-limit coverage and exactly-once queue→dispatch→completion→next-job path are represented in the final source/runtime path verified by the canary sequence.

## Chrome workforce live truth
- Canonical UI workers remain `NV02 | NV03 | NV04`.
- Current Controller startup is fail-safe `READ_ONLY`; workers remain enabled and attached to existing windows.
- Latest live heartbeat: NV02/NV03/NV04 all OPEN/ONLINE, `uiReady=true`, `authRequired=false`, `securityBlock=null`.
- Under Owner command `00`, Vy briefly enabled automation only to submit the independent #802 work order to NV02, then immediately restored `READ_ONLY`.
- NV02 accepted #802: Controller state is `SUBMITTED`; heartbeat is `uiBusy=true`. NV03/NV04 remain idle/ready.
- No Chrome window was closed, restarted, reloaded or force-killed during the #801 reconciliation and #802 dispatch.

## Worker Utility / active work
- #793 Worker Utility V1 remains the canonical APP for controlling NV02/NV03/NV04; source is `apps/worker-utility/**`.
- #801 is the Vy lane for Source of Truth reconciliation and final #763 audit. It must not modify `apps/worker-utility/**`.
- #802 is the independent NV02 lane for Worker Utility UI/UX. It owns `apps/worker-utility/**` and directly related tests/UI artefacts; it must not modify #801 Source of Truth/governance resources.
- Command `00` is the current dual-lane orchestration alias from Interaction #504 v27: Vy continues the primary lane while ChatGPT Plus (NV02) receives one independent safe lane.

## Workforce / identity
- Registry #335 remains authoritative for employee identity/capability.
- `NV02 = ChatGPT Plus` is the primary UI executor; `NV03 = ChatGPT Go` is independent review/support; `NV04 = Gemini Pro` is deep research/cross-check; `NV10 = Ollama` is local/Core AI.
- `NV05` and command `5` remain retired. `GPT-6 Astra` remains an on-demand high-tier resource of NV02, not a separate employee.

## Governance
- Interaction #504 v27 is current and contains the Owner override for command `00` dual-lane orchestration.
- Registry #335 v50 remains current; no identity/capability change was required by #801.
- Production release, paid service, credential/security mutation and destructive/irreversible actions remain separate authorization gates.

STATE: `CURRENT_20260917_763_EXACTLY_ONCE_E2E_VERIFIED_SOT_RECONCILIATION`
UI_STATE: `CURRENT_20260917_WORKER_UTILITY_CANONICAL_NV02_UI_LANE_ACTIVE`
