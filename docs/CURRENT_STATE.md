# TigerIQ — Current State

Date: 2026-09-15
Status: CURRENT — Autopilot source stack merged; Smart Router integrated on current main candidate; live runtime re-verification pending
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical source / runtime
- `main` source currently includes PR #776 (`NV10 = Ollama` source migration), PR #750 (Chrome Controller base), PR #766 (UI Autopilot Snapshot Adapter), PR #771 (Web Control Health parity), PR #764 (3-worker Autopilot/recovery), PR #774 (canonical Workforce NV01–NV20), and PR #779 (safe save/archive after DONE).
- Core `100.97.23.87:8795` and Web Control `100.97.23.87:8796` were ONLINE at the latest verified runtime checkpoint; merged source changes are not claimed live until an explicit maintenance verification.
- Coding Lane `8797` and Core Runtime Updater remain intentionally disabled.
- `vercel.json` has Git deployment disabled; merging source to `main` does not itself deploy Vercel Production.
- Chrome Controller is not restarted/deployed while a worker is OPEN.
- Engineering path remains GitHub branch → PR → required gates → merge; Production/live deployment is a separate risk gate.

## #777 Smart Router candidate — PR #778
- PR #778 is integrated on top of current `main` without replacing the already-merged Web Control/Workforce implementation.
- Employee identity and AI resource identity are separate: stable `resource_id` is provider/model/account/runtime based; current jobs/events keep backward compatibility and historical provenance is not rewritten.
- `NV10 = Ollama` remains canonical; `NV02 = ChatGPT Plus` remains the primary UI executor.
- Routing profiles: `AUTO`, `CODING`, `FAST`, `CHEAP`, `LOCAL`, `RESEARCH`, `REVIEW`.
- Router eligibility/scoring considers capability, health, cooldown, quota/rate limit, task-specific success/failure/latency/retry/failover history, cost tier, and reviewer-resource independence.
- Paid fallback is excluded. Auth/configuration/security/credential/paid/Production/irreversible failures are terminal and are never auto-bypassed.
- Quota telemetry preserves unknown as unknown, accepts ratio-only telemetry as known when present, penalizes near-limit resources, and honors the later of provider reset and active cooldown when both exist.
- Provider 429 handling preserves provider reset when available and otherwise uses bounded policy cooldown.
- Web Control Smart Router UI is a separate overlay loaded after canonical Workforce UI: `Nhân sự AI` remains Registry-derived; `Tài nguyên AI`, `Định tuyến AI`, and `Hiệu suất theo loại việc` are separate truthful projections from Core data.
- Phase 8 integration intentionally does not override the canonical `renderWorkers` implementation from #774, preventing employee/resource conflation and UI regression.
- Candidate is not deployed live and must not be described as runtime-active until maintenance verification.

## Web Control / workforce truth
- Web Control is the single Owner UI and refreshes `/api/status` every 2 seconds with stale-data visibility.
- Registry #335 remains the canonical employee source; all NV01–NV20 slots are represented, including retired/unassigned states without fake OFFLINE status.
- Workforce cards remain two fixed rows with horizontal scrolling at the verified desktop layout; Health-parity styling and mobile responsiveness are preserved from merged source.
- Smart Router adds a separate AI-resource panel rather than replacing workforce cards.

## Autopilot / Chrome source truth
- PR #750, #764, #766 and #779 are merged in source.
- Canonical Chrome workers are `NV02 | NV03 | NV04`; `NV05` remains retired; `NV10` is local/Core AI and not a Chrome worker.
- Safe save/archive is gated by external DONE evidence and fails closed for active/busy/blocked/security states.
- No Chrome Controller deployment/restart is performed by PR #778.

## AI Manager / queue truth
- #731 completed through PR #744; bounded manager JSON retry/failover and valid-decision-before-job rules remain in source.
- Ollama request timeout remains 30 seconds; provider failures use bounded cooldown/quarantine.
- Three real E2E runs had passed consecutively at the last verified runtime checkpoint.
- Latest verified queue checkpoint had no stale active objective/job; runtime must be re-read before making a newer live claim.

## Governance
- Protected-branch required checks: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- Owner authorization on 2026-09-15 allows NV01 to merge `main` when exact-head required checks pass and the merge itself cannot trigger Production/paid/credential/security/destructive/irreversible effects.
- Independent review is risk-based, not a mandatory human dependency; #778 received source review and regression fixes before final gate.
- Production/live deployment, paid actions, credential/security changes and destructive/irreversible actions remain separate authorization gates.

STATE: `CURRENT_20260915_AUTOPILOT_SOURCE_MERGED_SMART_ROUTER_INTEGRATED_CANDIDATE_LIVE_REVERIFY_PENDING`
UI_STATE: `CURRENT_20260915_WEB_CONTROL_CANONICAL_WORKFORCE_PLUS_ROUTING_OVERLAY_CANDIDATE`
