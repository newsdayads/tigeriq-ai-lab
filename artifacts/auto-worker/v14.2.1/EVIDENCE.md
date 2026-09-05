# V14.2.1 TEST CANDIDATE EVIDENCE — OFF-MAIN

Continues `artifacts/auto-worker/v14.2.0/CHECKPOINT.md`. This file does not rewrite the V14.2.0 historical checkpoint.

## Candidate
- Version: `14.2.1` TEST CANDIDATE / PHYSICAL PENDING.
- Branch: `auto-worker/v14.2.0-clean-successor`.
- Draft PR: #443.
- Owner-facing file: `TigerIQ_AW_14.2.1.cmd`.
- Exact extension ID targeted from the latest physical finding: `leidfhbpdillakmcbijagelghhilbnpc`.
- No MAIN/Production, no NV04/NV05 activation.

## Packaging model
- Owner CMD downloads one immutable, SHA-256-pinned installer source from commit `387cfdfc8f7e4bb6f5d2171bf48bd5f58d07c63d`.
- Installer source SHA-256: `228f23fdf9e071644186792a4ebf6115a73a96a60cd17bf6ec0aadef584ceaf2`.
- Installer source downloads its wrapper/runtime-guard/registry/library only from immutable source commit `7c5a1689d33f14d896accf66ea657bf75a230217`.
- Installer library SHA-256: `3eef112d3b750b9f51f72d3d9fb8d1e080a97f4a2002336155f3bae31ee4414a`.
- Local owner CMD SHA-256: `c684b2c17b2add7ee8b64361caf0502c481edfb18524ceb63a20530cd8fb7db4`.
- Internal source/evidence ZIP SHA-256: `645ee0f9a7f568f4e60e63a571668775c0685a5407dbf2c650323897616bad32`.

## Installer guarantees before physical test
- Does not `taskkill`, `Stop-Process`, uninstall, or require Chrome shutdown.
- Locates the unpacked extension through Chrome profile data for the exact extension ID first; command-line/key-derived fallback is fail-closed.
- Backs up the complete extension source before mutation and rolls back on installer/reload self-check failure.
- Preserves existing manifest `key`; Chrome extension state/config/evidence storage is not deleted or migrated.
- Does not start Chrome when Chrome was not already running.
- When Chrome is already running, opens the extension details page in the existing Chrome instance, invokes the extension Reload control through Windows UI Automation, then requires the Chrome UI to expose version `14.2.1`; otherwise rollback/fail, no fake success.
- Preserves the existing V13.4.10/V14 legacy runtime as a legacy service-worker payload and layers a pre-activation lifecycle/window guard in front of it rather than rebuilding completed baseline behavior.

## Pre-activation guard
- Exactly one managed ChatGPT worker window is permitted concurrently.
- Managed window bounds are computed from the real primary display workArea: `504×834`, Top `workArea.top+5`, Right `5`.
- Registry is compatibility-shaped for both old V14 `active` semantics and V14.2 authority fields: only NV02 is background active; NV04 is specialized/PENDING_OWNER_ACTIVATION; NV05 is PENDING_OWNER_ACTIVATION and routing diagnostic returns `COMMAND_PENDING_ACTIVATION`.
- Expected managed tab/window closes are suppressed from legacy `TAB_RECOVERY` / `WINDOW_RECOVERY`, preventing the known expected-close reopen loop.
- A second ChatGPT worker tab in the managed window is rejected pre-activation.
- Runtime marker records only candidate visibility and does not synthesize heartbeat/worker activity.

## Evidence before owner physical test
- Local JS syntax: PASS.
- Local deterministic wrapper mock: PASS (1920 workArea -> left 1411/top 5/504×834; second window blocked; second ChatGPT tab blocked; expected close does not invoke legacy recovery; a later cycle can create again).
- Static installer checks: PASS (no forced Chrome kill/uninstall; backup/rollback/key guard; pinned source; pre-activation authority).
- Exact-head CI/Queue/Vercel must be read from the current PR head after this evidence commit. Pre-evidence candidate head `10abf7bbc03396cb53ccb5f8555efe4dfb41e6fd` passed CI #1158, Queue Hygiene #530 and Vercel Verify #490; CI PowerShell syntax, Typecheck, Unit tests including installer invariants, Playwright and Build all passed.

## Physical boundary
PHYSICAL-E2E remains PENDING until anh Sơn double-clicks the owner CMD on PC01. Do not claim machine PASS. Required pre-activation evidence remains Chrome-open update, version/ID/key preservation, no reopen-loop, exactly one NV02 managed window at locked geometry, dynamic `2` routing, `4` non-background, `5=COMMAND_PENDING_ACTIVATION`, Archive/restart/crash/governor/NV01-yield behavior. No NV04/NV05 activation before explicit Owner authorization after the activation gate is ready.
