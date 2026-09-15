# TigerIQ — Current State

Date: 2026-09-15
Status: CURRENT — Autopilot + Smart Router source merged to main; live runtime re-verification pending
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical source / runtime
- `main` source includes PR #776 (`NV10 = Ollama` source migration), PR #750 (Chrome Controller base), PR #766 (UI Autopilot Snapshot Adapter), PR #771 (Web Control Health parity), PR #764 (3-worker Autopilot/recovery), PR #774 (canonical Workforce NV01–NV20), PR #779 (safe save/archive after DONE), and PR #778 (Smart Router + AI resource identity separation + routing telemetry).
- PR #778 merged to `main` at `12a252d12fbdae9bf5de4c27244bea0287ddc0ef` after exact-head required gates passed.
- Core `100.97.23.87:8795` and Web Control `100.97.23.87:8796` were ONLINE at the latest verified runtime checkpoint; newly merged source is not claimed live until an explicit maintenance verification.
- Coding Lane `8797` and Core Runtime Updater remain intentionally disabled.
- `vercel.json` has Git deployment disabled; merging source to `main` does not itself deploy Vercel Production.
- Chrome Controller is not restarted/deployed while a worker is OPEN.
- Engineering path remains GitHub branch → PR → required gates → merge; Production/live deployment is a separate risk gate.

## #777 Smart Router source truth
- Employee identity and AI resource identity are separate: stable `resource_id` is provider/model/account/runtime based; current jobs/events keep backward compatibility and historical provenance is not rewritten.
- `NV10 = Ollama` remains canonical; `NV02 = ChatGPT Plus` remains the primary UI executor.
- Routing profiles: `AUTO`, `CODING`, `FAST`, `CHEAP`, `LOCAL`, `RESEARCH`, `REVIEW`.
- Router eligibility/scoring considers capability, health, cooldown, quota/rate limit, task-specific success/failure/latency/retry/failover history, cost tier, and reviewer-resource independence.
- Paid fallback is excluded. Auth/configuration/security/credential/paid/Production/irreversible failures are terminal and are never auto-bypassed.
- Quota telemetry preserves unknown as unknown, accepts ratio-only telemetry as known when present, penalizes near-limit resources, and honors the later of provider reset and active cooldown when both exist.
- Provider 429 handling preserves provider reset when available and otherwise uses bounded policy cooldown.
- Web Control Smart Router UI is a separate overlay loaded after canonical Workforce UI: `Nhân sự AI` remains Registry-derived; `Tài nguyên AI`, `Định tuyến AI`, and `Hiệu suất theo loại việc` are separate truthful projections from Core data.
- Smart Router overlay does not override the canonical `renderWorkers` implementation from #774, preventing employee/resource conflation and preserving the merged Health-parity/Workforce UI.
- Source is merged; runtime activation remains pending maintenance deployment/re-verification and must not be claimed active before evidence.

## Final source gate evidence for PR #778
- Final tested head: `52f7fdf404037a2ee4a18b7e84550e3e00c8ccda`.
- `CI Verify`: PASS.
- `Queue Hygiene Verify`: PASS.
- `Vercel Online Verify`: PASS.
- Vitest: `42 files / 219 tests` PASS.
- Playwright foundation E2E: `1/1` PASS.
- Typecheck, build, Vercel deployment/routing policy and PowerShell syntax verification: PASS.
- Independent source review found and fixed ratio-only quota classification and reset/cooldown recovery ordering before final gate.
- A first final-gate attempt failed only on a newly added static assertion (`r.quota_state` versus implemented `resource?.quota_state`); the test assertion was corrected without changing runtime logic, then the exact-head gate passed.

## Web Control / workforce truth
- Web Control is the single Owner UI and refreshes `/api/status` every 2 seconds with stale-data visibility.
- Registry #335 remains the canonical employee source; all NV01–NV20 slots are represented, including retired/unassigned states without fake OFFLINE status.
- Workforce cards remain two fixed rows with horizontal scrolling at the verified desktop layout; Health-parity styling and mobile responsiveness are preserved in source.
- Smart Router adds separate AI-resource/routing/performance projections rather than replacing workforce cards.

## Autopilot / Chrome source truth
- PR #750, #764, #766 and #779 are merged in source.
- Canonical Chrome workers are `NV02 | NV03 | NV04`; `NV05` remains retired; `NV10` is local/Core AI and not a Chrome worker.
- Safe save/archive is gated by external DONE evidence and fails closed for active/busy/blocked/security states.
- PR #778 performed no Chrome Controller deployment/restart.

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

STATE: `CURRENT_20260915_AUTOPILOT_AND_SMART_ROUTER_SOURCE_MERGED_LIVE_REVERIFY_PENDING`
UI_STATE: `CURRENT_20260915_WEB_CONTROL_CANONICAL_WORKFORCE_PLUS_ROUTING_OVERLAY_SOURCE_MERGED`
