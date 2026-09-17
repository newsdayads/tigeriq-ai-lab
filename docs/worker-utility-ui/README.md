# TigerIQ Worker Utility V1 — UI/UX Package (NV03)

Scope: independent UI/UX artefacts for #793. No backend, ChromeController, CDP, scheduler, persistence, installer, or integration ownership is changed.

## Popup contract
- Width: 320px default; supported 280–350px. Height grows only within the utility window; no content overlay on Chrome.
- Header: worker icon + NV02/NV03/NV04 + READY/WORKING/BLOCKED/PAUSED + elapsed time.
- Job row: current job, start time, last update.
- Primary controls: Run/Continue, Pause.
- Window controls: Fix position, Lock position, Focus.
- Navigation: Open canonical, Quick check.
- Persistence: Save, Save & Archive. Archive action is disabled unless backend reports DURABLE receipt.
- Safety: Safe Close, Recover. Safe Close disabled while active job/mutation is non-terminal.
- Schedule: 10m, 30m, 1h, 2h, Custom; next run; Cancel; DND.
- Recent logs: 5–10 entries; Advanced opens technical diagnostics without exposing credentials.

## Visual state contract
READY=neutral/positive; WORKING=active; BLOCKED=attention; PAUSED=inactive. Never encode state by color alone: every state has text + icon/shape + accessible name.

## Placement contract
- Default anchor: worker-specific fixed slot, respecting work-area bounds.
- DPI: use device-independent units; never assume 96 DPI.
- Multi-monitor: clamp popup to the target monitor work area; preserve worker monitor identity.
- FancyZones: move/focus only; never reload Chrome or alter page content.
- Minimize/restore: utility stores logical target, re-resolves window handle on restore; stale handle => BLOCKED, not false ONLINE.
- DND: worker continues; no focus/reflow/popup; only state/log counters update.
- Native icon must stay outside the page content and remain click-target >= 24x24 effective pixels.

## Accessibility / keyboard
- Full keyboard traversal; visible focus ring; logical order: worker header -> primary -> window -> navigation -> persistence -> safety -> schedule -> logs -> Advanced.
- Enter/Space activates focused button; Esc closes popup without changing worker state.
- Tooltip text is supplementary, never the only label.
- Minimum effective hit target 24x24; critical actions use explicit confirmation copy from API policy, not client-side bypass.

## Safety UX
The UI is a safety gate, not an authority. Backend/API state is authoritative. Unknown/stale state renders BLOCKED or unavailable and never invents ONLINE. AUTH/REAUTH/CAPTCHA/RATE_LIMIT/429/security warning => visible BLOCKED reason and Run/Continue disabled.

## Ownership boundary
NV03 owns only this package:
- `docs/worker-utility-ui/**`
- `assets/worker-utility/**`
- `prototype/worker-utility-ui/**`

Do not edit NV02 resource/core/integration paths.
