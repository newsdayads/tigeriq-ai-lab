# #793 NV03 UI/UX Acceptance & Adversarial Checklist

## Functional presentation
- [ ] Popup renders at 280–350px width; default 320px.
- [ ] Worker identity is unambiguous for NV02/NV03/NV04.
- [ ] READY/WORKING/BLOCKED/PAUSED are text + icon/shape, not color-only.
- [ ] HEALTHY/SLOW/STALLED/RECOVERING/BLOCKED watchdog states are visible.
- [ ] Current job, elapsed time, last update and no-progress duration are visible.
- [ ] Run/Continue and Pause are distinct.
- [ ] Fix position, Lock position and Focus are distinct.
- [ ] Open canonical and Quick check are distinct.
- [ ] Save & Archive is unavailable without authoritative durable receipt.
- [ ] Safe Close is unavailable for active non-terminal mutation.
- [ ] Schedule supports 10m/30m/1h/2h/Custom + Cancel + DND.
- [ ] Recent logs expose bounded entries; Advanced does not expose credentials.

## Placement / desktop adversarial tests
- [ ] 100/125/150/200% DPI does not clip or shrink below effective 24x24 targets.
- [ ] Popup clamps inside each monitor work area and preserves worker monitor identity.
- [ ] FancyZones move/focus never reloads or alters page content.
- [ ] Minimize/restore re-resolves the target handle; stale handle becomes BLOCKED.
- [ ] DND suppresses focus/reflow/popup while state/log counters continue.
- [ ] Three workers never overlap their native icons or route a click to the wrong worker.

## Watchdog adversarial tests
- [ ] Alive heartbeat without progress reaches SLOW/STALLED according to authoritative thresholds.
- [ ] Missing progress for 2m renders STALLED for an active job.
- [ ] 5m escalation shows bounded recovery state, retry count and cooldown.
- [ ] Recovery permits only one step at a time.
- [ ] Duplicate Run/Continue is disabled during RECOVERING.
- [ ] Session mismatch, AUTH, CAPTCHA, RATE_LIMIT/429, or security warning fail closed to BLOCKED.
- [ ] Recovery never reloads Chrome and never force-kills a worker/controller.
- [ ] Recovery evidence/audit reference is shown when provided by the authoritative API.

## Keyboard/accessibility
- [ ] Tab order follows header → primary → window → navigation → persistence → safety → schedule → logs → Advanced.
- [ ] Enter/Space activates focused controls; Esc closes without changing worker state.
- [ ] Visible focus indicator remains visible at all supported DPI settings.
- [ ] Accessible names identify worker, state and action; tooltip is never the only label.

## Scope guard
- [ ] Only NV03-owned paths are changed: docs/worker-utility-ui/**, assets/worker-utility/**, prototype/worker-utility-ui/**.
- [ ] No backend/controller/integration/core path is modified by this UI package.
