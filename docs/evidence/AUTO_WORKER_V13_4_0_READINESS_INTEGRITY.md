# Auto Worker V13.4.0 — Physical Batch Integrity R2

Parent: #306
Branch: `fix/306-auto-worker-v13-4-0-readiness-integrity`
Status: OFF-MAIN / READY_FOR_PHYSICAL_CHROME_TEST

## Physical findings confirmed
1. **Managed window still oversized**: V13.4.0 R1 could reuse an already-managed normal/maximized Chrome window and only inject runtime, so the adaptive bounds path was bypassed.
2. **Wrong Project navigation**: direct boot to the stored `/g/<project-id>` route can fail live and redirect to ChatGPT root with `Không tìm thấy dự án này`; relying on a fixed direct project URL is not robust enough.
3. **Status taskbar not visible at launch**: R1 intentionally left `#bar` hidden until Tiger icon click, which now conflicts with Owner's latest requirement to see employee/status immediately.

## R2 fixes
- Boot safely at `https://chatgpt.com/`, then discover the exact current **TigerIQ AI Lab** link from the live sidebar, persist its dynamic project base, navigate using that exact href, and only dispatch `2` after the existing readiness gate passes.
- Keep 5×500 ms route/composer stability + 1500 ms grace + 90 s bounded timeout; wrong/intermediate page never dispatches.
- One-time R2 repair normalizes an already-managed oversized/maximized window back to the small adaptive bounds; thereafter user resize/maximize stays authoritative and is not forced every tick.
- Recovery bounds minimum corrected to 340×480 so recovery does not silently enlarge a small user window.
- Tiger icon remains visible; compact status panel now opens **by default** and shows `Khoa · NV02 · Vận hành tự động` + live state. Tiger icon toggles the panel.
- Same-version R2 adds a one-time managed-tab reload key so the old R1 content script cannot remain alive after extension update.
- Preserve anti-duplicate dispatch, Pause/Stop authority, persisted cycle/session/turn, bounded recovery, minute-29 drain, response/tail watchdogs, local evidence, no notifications.

## R2 evidence
- `node --check` background/runtime/popup/installer: **ĐẠT**.
- Background mocked Chrome API smoke: **ĐẠT**.
- R2 contract audit: **42/42 ĐẠT**.
- Exact packaged mock update from V13.4.0 R1-shaped manifest/source -> R2 payload: **ĐẠT**.
- Manifest remains V13.4-only; extension key preserved fail-closed: **ĐẠT**.
- Robust `.cmd` wrapper uses short Node bootstrap + appended Base64 payload; max command line 494 chars; payload roundtrip equals tested installer source: **ĐẠT**.

## R2 artifact
`TIGERIQ_AUTO_WORKER_V13_4_0_PHYSICAL_FIX_R2.cmd`
SHA-256: `ed435260b2e6ebf2e101aa09f3285bfab9492f1176850ac1778b4d3148e3ccce`

Source/test ZIP SHA-256: `d9dea669601b3250c7d5e29adf126f74bde7dfed06dfd3c32d3db40bec07200f`

## Remaining gate
Physical Chrome update/reload + #306 A–N plus: small-window correction, exact live sidebar Project navigation, status panel auto-open with Khoa/NV02 identity, slow-network no-early/no-duplicate `2`, user-resize/recovery bounds.

No MAIN/Production/Vercel/paid/credential/security/reboot mutation.