# TigerIQ — Current State

Date: 2026-09-15
Status: CURRENT — Core autonomous manager E2E verified; Web Control unified Owner UI candidate live with canonical workforce cards
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical runtime
- `main` source SHA at this snapshot: `33697fdf4b36f0a83d49bd30ce24fc093e3a81fe`.
- Core `100.97.23.87:8795`: ONLINE; backend/API truth and temporary API Health reference UI.
- Web Control `100.97.23.87:8796`: ONLINE; single Owner management UI candidate.
- Coding Lane `8797`: intentionally Disabled; legacy autonomous coding path is not active.
- Core Runtime Updater: intentionally Disabled.
- Desktop Commander Remote and Ollama Runtime: Running.
- Engineering path: GitHub branch → PR → required gates → merge; no direct `main` source editing on PC01.

## Web Control Owner UI — #770 + #772
- #770 - Đồng bộ icon/CSS API Health + live refresh + font hệ thống: OWNER_DIRECT / P1.
- #771 - Parity API Health + live refresh + system font: OPEN on branch `nv05/issue-767-health-parity-font-refresh`; not merged at this snapshot.
- #772 - Workforce cards NV01–NV20, 2 hàng + kéo ngang: OWNER_DIRECT / P1.
- #774 - Full workforce cards NV01–NV20, 2-row strip: OPEN on branch `nv05/issue-772-workforce-cards`, based on the current Web Control UI branch; not merged.
- Candidate source was loaded to PC01 Web Control for Owner visual acceptance without replacing `main`.
- Web Control refreshes `/api/status` every 2 seconds and exposes `LIVE · 2s`; stale data remains fail-visible.
- API Health visual/function pattern is represented in Web Control: KPI cards, provider/API health, telemetry/P95 chart, recent jobs, compact events and Local/Cloud/Problem filters.
- Top navigation is horizontal; brand is `TigerIQ AI`; redundant legacy title/status row is collapsed.
- Typography: `"Segoe UI", Roboto, Helvetica, Arial, sans-serif` at 14px/1.5 with antialiasing; code/log/terminal use SFMono/Consolas/Roboto Mono stack at 13px.

## Canonical workforce cards — #772 verified
- Identity source is Registry #335; runtime/API data only enriches canonical employees.
- Web Control `/api/status` verified live with `workforce=20`, `source=registry-335-live`, `version=49`.
- All slots `NV01` through `NV20` render. Current unassigned/retired slots remain visible with truthful state rather than fake OFFLINE.
- Current identity projection follows Registry v49: `NV02 = ChatGPT Plus`; `NV10 = Ollama`; legacy Core `NV02/Ollama` is projected to `NV10/Ollama` in Web Control without mutating Core truth.
- Card strip is exactly two fixed rows with horizontal scrolling; compact card body shows employee/name, role/provider and status. Technical model/latency/success/error/cooldown details are available by hover tooltip.
- Runtime DOM evidence at 1920×1080: 20 cards; rows `82px 82px`; `overflow-x:auto`; horizontal scroll true; live refresh present.
- Evidence: `evidence/issue-772-web-control-workforce-cards.md`; PC01 screenshot: `D:\TigerIQ\Evidence\web-control-workforce-2row-20260915.png`.

## AI Manager / autonomy
- #731 completed through PR #744.
- Manager malformed/trailing/status-invalid JSON is handled by bounded same-provider retry once, then bounded zero-cost provider failover.
- Manager creates jobs only after a valid decision is parsed.
- Ollama request timeout is 30s.
- Provider failures use bounded cooldown; NV16 provider/configuration failures are quarantined from repeated hammering.
- Three real E2E runs passed consecutively without Owner intervention: objective accepted → Manager decomposed → NV19 executed → job DONE → objective COMPLETED.

## Queue truth
- #735 queue hygiene: DONE.
- Runtime verification after #731/#733: active objectives = 0; queued/running/review/waiting_ci jobs = 0.
- No stale active queue item remained; history/evidence preserved.

## Resource truth
- Canonical identity: `NV10 = Ollama`; current Core still emits a legacy `NV02/Ollama` runtime identifier and Web Control normalizes only its UI projection to NV10 pending Core migration.
- NV12 Gemini and NV14 Mistral: provider-side rate-limit/cooldown paths exist and do not block the pipeline.
- NV16 Hugging Face: provider/configuration error path isolated with cooldown/quarantine.
- NV11/NV13/NV15/NV19 remain zero-cost resources when healthy; NV20 remains WAIT_KEY until credential provisioning is explicitly resumed.

## Governance
- Required protected-branch checks remain CI Verify, Queue Hygiene Verify and Vercel Online Verify where applicable to the target branch.
- Owner explicitly waived independent AI review for the current Web Control UI iteration; source still remains branch/PR controlled and not merged to `main`.
- #718 acceptance condition of 3 consecutive real E2E runs remains satisfied; final governance/backlog closure is separate.

STATE: `CURRENT_20260915_CORE_MANAGER_3X_E2E_PASS_QUEUE_CLEAN`
UI_STATE: `CURRENT_20260915_WEB_CONTROL_WORKFORCE_20_TWO_ROWS_LIVE_CANDIDATE`
