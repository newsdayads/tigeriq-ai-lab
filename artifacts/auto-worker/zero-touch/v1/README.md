# TigerIQ Auto Worker — Zero-Touch Updater v1

Status: OFF-MAIN candidate. Parent: #441. HOT STATE: #458.

## Goal
Replace repeated manual candidate installation with a pinned, transactional local updater:

`manifest SHA pin -> immutable source commit -> payload provenance verify -> stage full current extension -> preserve key/state -> same-volume swap -> Chrome-open reload -> health -> rollback`

## Safety invariants
- Extension ID: `leidfhbpdillakmcbijagelghhilbnpc`.
- Existing manifest `key` must derive to the same extension ID before and after update.
- Chrome is never task-killed, forcibly closed, or launched when it was previously stopped.
- When Chrome is already running, reload uses the bounded extension-management UI handshake.
- NV02 remains the only background-active employee before #440 + explicit Owner activation.
- NV04/NV05 remain inactive; NV03 remains paused.
- No MAIN/Production/paid/credential/security widening/reboot/irreversible action.

## Current pinned manifest
- Candidate: `14.2.2`
- Manifest: `manifest.v14.2.2.json`
- Manifest SHA-256: `d3e8f3840209924038980fd595600db97a718be9bed20ff39bf7e10b5b4b1fca`
- Immutable payload source commit: `47e687488d57132ba8ee567f760b8bd38fcf74ca`
- Payload provenance uses exact Git blob SHA-1 plus immutable commit pin.

The updater requires both `ManifestUri` and `ExpectedManifestSha256`; an unpinned manifest fails closed.

## Transaction model
1. Validate manifest/repo/commit/extension ID.
2. Validate current extension key -> expected ID.
3. Copy the complete current extension to a sibling staging directory.
4. Download payloads only from the manifest's immutable GitHub commit and verify each Git blob hash.
5. Preserve legacy service worker and overlay the V14.2 wrapper/guard/registry.
6. Patch only bounded manifest fields while preserving `key` and existing Chrome storage state.
7. Run health checks on the stage.
8. Rename current extension to sibling backup, rename stage to the original extension path.
9. Run health again; if Chrome was already running, reload/confirm the target version.
10. On any post-swap failure, restore the backup automatically.

## Sanitized machine evidence
Updater writes only fixed fields to:

`%LOCALAPPDATA%\TigerIQ\AutoWorker\zero-touch-status.json`

`autoworker-deploy-status.ps1` is a narrow read-only reader for those fields and does not provide arbitrary file-read or shell execution.

## Automated evidence
Windows workflow `auto-worker-zero-touch-windows.yml` exercises:
- three consecutive fixture upgrades with no manual install step;
- key preservation;
- legacy rollback payload retention;
- forced health failure;
- automatic rollback;
- sanitized status evidence.

This is deterministic CI/mock evidence only. Real PC01/Chrome acceptance still requires 3 consecutive real upgrades with Chrome open, preserved ID/key/state, no duplicate/reopen-loop, and rollback evidence.
