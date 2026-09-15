# TigerIQ — Current State

Date: 2026-09-15
Status: IN REVIEW — #777 Smart Router foundation is implemented on draft PR #778; canonical `main`/runtime remain unchanged until authorized merge/deploy
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical runtime
- Canonical `main` source SHA: `33697fdf4b36f0a83d49bd30ce24fc093e3a81fe`.
- #777 implementation branch / draft PR #778 head: `3ec82242ec5823c5cfe003a885d674f1589dee56`; CI/Queue Hygiene/Vercel Online checks are green. This is not yet runtime truth.
- Core `100.97.23.87:8795`: ONLINE.
- Web Control `100.97.23.87:8796`: ONLINE.
- Coding Lane `8797`: intentionally Disabled; legacy autonomous coding path is not active.
- Core Runtime Updater: intentionally Disabled.
- Desktop Commander Remote and Ollama Runtime: Running.
- Engineering path: GitHub branch → PR → required gates → merge; no direct `main` source editing on PC01.

## AI Manager / autonomy
- Issue #731 completed through PR #744.
- Manager malformed/trailing/status-invalid JSON is handled by bounded same-provider retry once, then bounded zero-cost provider failover.
- Manager creates jobs only after a valid decision is parsed.
- Ollama request timeout is 30s.
- Provider failures use bounded cooldown; NV16 HTTP 402/configuration failures are quarantined from repeated hammering.
- PR #778 adds policy/capability-aware Smart Router profiles (`AUTO/CODING/FAST/CHEAP/LOCAL/RESEARCH/REVIEW`), reviewer-resource independence, provider quota reset handling, task-kind performance evidence, and terminal failure stop policy. No paid fallback.
- Three real E2E runs passed consecutively without Owner intervention: objective accepted → Manager decomposed → NV19 executed → job DONE → objective COMPLETED.

## Queue truth
- Issue #735 queue hygiene: DONE.
- Runtime verification after #731/#733: active objectives = 0; queued/running/review/waiting_ci jobs = 0.
- No stale active queue item remained; history/evidence preserved.

## Resource truth
- Canonical Registry mapping is Ollama = `NV10`; `NV02` is ChatGPT Plus / primary executor. PR #776 and PR #778 source use NV10 for current Ollama identity. Runtime is not re-claimed until merge/deploy/live verification.
- PR #778 separates `employee_id` from stable `resource_id` (provider/model/account/runtime) while preserving historical jobs/events provenance and backward compatibility.
- Web Control on PR #778 now keeps canonical NV cards deduplicated by `employee_id` and renders a separate `Tài nguyên AI` panel with provider/model/state/latency/success/error/cooldown/quota truth.
- Prior 2026-09-14 live snapshot: NV12 Gemini and NV14 Mistral were provider-side RATE_LIMITED; NV16 Hugging Face was isolated on provider/configuration failure; NV11/NV13/NV15/NV19 were usable when healthy; NV20 remained WAIT_KEY.

## Governance
- Required checks remain: CI Verify, Queue Hygiene Verify, Vercel Online Verify; all three are green for PR #778 head `3ec82242`.
- No external human GitHub reviewer is required; independent AI review/evidence is sufficient unless Owner changes policy.
- PR #778 remains draft/open; no merge and no Production/runtime deployment occurred in #777 scope.
- Phase 2 PR #764 remains draft/non-mergeable and PR #766 remains draft/open; runtime Chrome Controller deploy/restart is intentionally untouched while NV windows may be active.

STATE: `CURRENT_20260915_ISSUE777_PR778_CI_GREEN_REVIEW_GATE_PENDING`
