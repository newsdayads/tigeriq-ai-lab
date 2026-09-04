# Auto Worker V13.4.0 — Physical Batch Integrity

Parent: #306
Branch: `fix/306-auto-worker-v13-4-0-readiness-integrity`
Status: OFF-MAIN / READY_FOR_PHYSICAL_CHROME_TEST

## Physical findings batched
1. Managed window regression: restore adaptive ~26% width × 60% height, default clamp 340–520 × 480–760, right anchored; persist user normal bounds and restore on same-cycle recovery.
2. Tiger icon is visible by default on the right while managed session is active; taskbar stays hidden until icon click; no full-width/legacy header.
3. Navigation/readiness race: command `2` is forbidden until exact TigerIQ AI Lab project route is stable, document is complete, composer is visible/enabled, URL is stable for 5 × 500 ms, then an additional 1500 ms bounded grace passes. Readiness timeout is 90 s; retry navigation is bounded and never sends on wrong/intermediate page.

## Additional audit fixes
- Manual pause/stop race: content runtime no longer writes a full stale state object; background remains authoritative and runtime refreshes mode before the final submit click.
- Mixed-version update race: when migrating from V13.3.x with a managed tab already open, V13.4 reloads only that managed tab once so old content-script timers cannot coexist and duplicate dispatch.
- Removed unnecessary `system.display` permission; layout derives from Chrome window geometry and stays within existing authority.
- Preserved anti-duplicate pending guard, physical `2` reconciliation, single-launch mutex, max 3 launch failures, AUTO/ONE recovery, minute-29 drain, >5 min wait-only, 12 min response watchdog, tail verify 30 s × 2, safe/emergency stop semantics, local evidence snapshot, V13.3 state migration, no notifications.

## Local/static evidence
- `node --check`: background/runtime/popup/installer — ĐẠT.
- Background load smoke with mocked Chrome APIs — ĐẠT.
- Contract audit: 34/34 — ĐẠT.
- Mock installer from V13.3.6-shaped manifest → V13.4.0 — ĐẠT.
- Manifest references V13.4 only; existing manifest key is preserved fail-closed — ĐẠT.
- Exact CMD embedded installer payload equals tested installer source — ĐẠT.

## Artifact
`TIGERIQ_AUTO_WORKER_V13_4_0_PHYSICAL_BATCH_UPDATE.cmd`
SHA-256: `c7c5cad1fba4104113c394673a212829b28789d2d2f26bd69e771060d74bc8b7`

Source/test package SHA-256: `96cdf867fc18f7bda0e1ef82e69e47e920e27d6b6b9c355c1d8189a90f3620b7`

## Remaining gate
Physical Chrome update/reload + #306 regression A–N plus: small-window, Tiger icon visible-by-default, user-resize persistence/recovery, exact Project readiness before first/recovery `2`, slow-network no-early/no-duplicate dispatch.

No MAIN/Production/Vercel/paid/credential/security/reboot mutation.