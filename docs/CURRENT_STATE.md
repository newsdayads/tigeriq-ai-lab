# TigerIQ — Current State

Date: 2026-09-15
Status: CURRENT — Autopilot + Smart Router source merged and live runtime verified on PC01
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical source / runtime
- `main` source includes PR #776 (`NV10 = Ollama` source migration), PR #750 (Chrome Controller base), PR #766 (UI Autopilot Snapshot Adapter), PR #771 (Web Control Health parity), PR #764 (3-worker Autopilot/recovery), PR #774 (canonical Workforce NV01–NV20), PR #779 (safe save/archive after DONE), PR #778 (Smart Router + AI resource identity separation + routing telemetry), PR #781 (complete Web Control runtime bundle sync), and PR #782 (include `workforce-registry.mjs` in runtime bundle).
- Latest verified source/runtime SHA on PC01: `af7e48f9198c85812e0c01e55160b2ff9fcb9e69`.
- Core `100.97.23.87:8795` is ONLINE on PID `11684`; Web Control `100.97.23.87:8796` is ONLINE on PID `27740`.
- Chrome Controller remains untouched on PID `30300` at `127.0.0.1:8798`.
- Coding Lane `8797` and Core Runtime Updater remain intentionally disabled.
- `vercel.json` has Git deployment disabled; no Vercel Production release was performed.

## #777 Smart Router — source and live truth
- PR #778 merged to `main` after exact-head `CI Verify`, `Queue Hygiene Verify`, and `Vercel Online Verify` passed.
- Final PR #778 test evidence: Vitest `42 files / 219 tests` PASS; Playwright foundation E2E `1/1` PASS; typecheck/build/Vercel policy/PowerShell syntax PASS.
- Employee identity and AI resource identity are separate: stable `resource_id` is provider/model/account/runtime based; current jobs/events keep backward compatibility and historical provenance is not rewritten.
- `NV10 = Ollama`; stale Ollama identity `NV02` is no longer present in live Core resources. `NV02 = ChatGPT Plus` remains the primary UI executor.
- Routing profiles: `AUTO`, `CODING`, `FAST`, `CHEAP`, `LOCAL`, `RESEARCH`, `REVIEW`.
- Router eligibility/scoring considers capability, health, cooldown, quota/rate limit, task-specific performance, cost tier, and reviewer-resource independence; paid fallback is excluded.
- Auth/configuration/security/credential/paid/Production/irreversible failures remain terminal and are never auto-bypassed.
- Quota telemetry preserves unknown as unknown, treats ratio-only telemetry as known, penalizes near-limit resources, and honors the later of provider reset and active cooldown.
- Live Core verification: `routing=true`, `resources=11`, Ollama resource `res:ollama:qwen3-4b:default:core` is owned by `NV10`, active objectives `0`, active jobs `0`.

## Web Control / workforce truth
- Web Control is the single Owner UI and refreshes `/api/status` every 2 seconds with stale-data visibility.
- Registry #335 remains the canonical employee source; all NV01–NV20 slots are represented, including retired/unassigned states without fake OFFLINE status.
- Live Web verification: `workforce=20`, `resources=11`, `routing=true`.
- `/web-control-routing.js` and `/web-control-routing.css` both returned HTTP `200` after maintenance.
- `Nhân sự AI` remains Registry-derived; `Tài nguyên AI`, `Định tuyến AI`, and `Hiệu suất theo loại việc` are separate Core projections.
- Smart Router overlay does not replace the canonical Workforce renderer.

## Autopilot / Chrome source truth
- PR #750, #764, #766 and #779 are merged in source.
- Canonical Chrome workers are `NV02 | NV03 | NV04`; `NV05` remains retired; `NV10` is local/Core AI and not a Chrome worker.
- Safe save/archive is gated by external DONE evidence and fails closed for active/busy/blocked/security states.
- #777 maintenance did not restart or deploy Chrome Controller; PID `30300` stayed unchanged through Core/Web activation.

## Maintenance evidence / safeguards
- The first maintenance attempt did not obtain new Core health and automatically rolled back to the previous source/runtime; Core and Web stayed recoverable and Chrome Controller was unchanged.
- Runtime DB read-only verification then confirmed both legacy Ollama rows were IDLE with `current_job_id=null` and there were no active jobs.
- Successful retry preserved the existing Core supervisor and restarted only the Core Node child; new Core came ONLINE with `routing=true` and only `NV10` as Ollama.
- Web Control was then restarted from the canonical runtime bundle and verified independently.
- Pre-maintenance dirty workspace changes were preserved in a reversible git stash rather than deleted.
- Core Runtime Updater remains disabled; task-level supervisor restart behavior discovered during maintenance is tracked separately and is not enabled automatically.

## Governance
- Protected-branch required checks: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- Owner authorization on 2026-09-15 allows NV01 to merge `main` when exact-head required checks pass and the merge itself cannot trigger Production/paid/credential/security/destructive/irreversible effects.
- Production release, paid actions, credential/security changes and destructive/irreversible actions remain separate authorization gates.

STATE: `CURRENT_20260915_AUTOPILOT_AND_SMART_ROUTER_LIVE_VERIFIED`
UI_STATE: `CURRENT_20260915_WEB_CONTROL_CANONICAL_WORKFORCE_PLUS_ROUTING_OVERLAY_LIVE_VERIFIED`
