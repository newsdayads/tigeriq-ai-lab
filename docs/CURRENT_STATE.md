# TigerIQ — Current State

Date: 2026-09-14
Status: CURRENT — Core/Web healthy, autonomous manager E2E verified, active queue clean
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical runtime
- GitHub `main` SHA before this SOT sync: `354b8abf4ea35230005e1802c96f72bc5133a130`.
- Core: `100.97.23.87:8795` — ONLINE.
- Web Control: `100.97.23.87:8796` — ONLINE.
- Coding Lane Scheduled Task: DISABLED by current policy.
- Core Runtime Updater Scheduled Task: DISABLED by current policy.
- Desktop Commander Remote and Ollama Runtime: RUNNING.
- Source path: GitHub branch → PR → required gates → merge. No direct `main` source editing on PC01.

## AI Manager / 24x7 autonomy
- PR #744 merged: bounded Manager JSON retry/failover plus worker failure handling.
- Issue #731 completed.
- Three real E2E runs passed consecutively without Owner intervention: objective received → Manager created job → NV19/Cohere executed → job DONE → objective auto-COMPLETED.
- Each validation completed in 2 manager cycles; no repeating MANAGER_JSON_MISSING / MANAGER_STATUS_INVALID loop was observed after rollout.

## Resource handling
- NV02 Ollama: ONLINE/IDLE after live probe; 30s timeout path is active.
- NV12 Gemini: provider-side RATE_LIMITED; 4.5s throttle + bounded exponential backoff + outer failover remain active.
- NV14 Mistral: provider-side RATE_LIMITED with cooldown/failover.
- NV16 HuggingFace: ERROR/configuration path with cooldown/quarantine; does not block the pipeline.
- Zero-cost/fail-closed policy remains in force; no paid fallback.

## Queue truth
- Issue #735 queue hygiene completed after runtime verification.
- Core `/api/status`: active objectives = 0; queued/running/review/waiting_ci jobs = 0 at verification time.
- Terminal/history evidence is retained; stale active items are not present in current queue truth.

## Web / governance
- PR #742 Web Control live-health + compact objective is merged.
- PR #737 legacy coding-autonomy quarantine was closed without merge as stale/conflicting.
- Persistent governance sources remain: CENTRAL #280, Registry #335, Interaction #504, browser guardrail #497.
- Required PR checks remain: CI Verify, Queue Hygiene Verify, Vercel Online Verify.

## Source of Truth
- This file is the concise repository snapshot.
- Google Drive shared state is mirrored separately under `TigerIQ AI Lab/00_SHARED_STATE`.
- Runtime truth is read from Core/Web live endpoints; chat/memory is not runtime authority.

STATE: `CURRENT_20260914_MANAGER_E2E_3X_PASS_QUEUE_CLEAN_CORE_WEB_ONLINE`
