# V14.2.0 HANDOFF CHECKPOINT — OFF-MAIN

Parent authority: #441 / #440 / #306 / #395 / #401; CENTRAL #280 + Registry #335.

Successor branch: `auto-worker/v14.2.0-clean-successor`, created from exact V14 branch head `3601be70bfc2fa8e1941a23338196d0f1c9b2d66` only as a handoff anchor. The production/source files for V14.2.0 were built and tested locally at checkpoint; do not assume they are committed to this branch until verified.

## Owner findings fixed in local V14.2.0 candidate
- V14.0.0 reopen-loop is invalid machine behavior; expected/archive/stop close must never become recovery.
- 1 extension, one managed Chrome window per background-active employee only.
- Pre-activation exactly NV02/Khoa background Auto. NV04/Khải resolves specialized identity but `background_auto=false`; NV05/An returns `COMMAND_PENDING_ACTIVATION`. NV03 paused. Do not auto-activate NV04/NV05.
- Post-activation target only after #440 + explicit Owner update: NV02/NV04/NV05.
- Exact window 504x834 / Top5. NV02 Right5; NV04 and NV05 each one full window + 5px further left (509px step), not 5px overlap. Real display workArea; fail closed if insufficient space.
- Packaged Registry authority split: registered/enabled/background_auto_allowed/activation_state/runtime_active + pre-activation command policy.
- Installer design does not require Chrome to close: in-place update, preserve key/extension ID, and if Chrome is already running use temporary extension-page `chrome.runtime.reload()` handshake with loopback callback; never taskkill and never launch Chrome when it was not already running.

## Local candidate evidence
- Candidate: `14.2.0`.
- Owner-facing installer: `TigerIQ_AW_14.2.0.cmd` SHA-256 `1f56a8256112f0ccd45b8f9c8e4ae5b8f3f496935a6c2a42ef31051786db5f23`.
- Source/evidence ZIP SHA-256 `00c47ec821c4a595d8c3346340f9d0fb3e78f80126b5641858826dcf420c586c` (internal evidence; Owner should only need the CMD).
- Core SHA-256 `e2affac1b929a163ad0883a76fb23e9a604bcbd36237585443fd5cfeda856268`.
- Background SHA-256 `8280b358c9eb97383f29beda5ea72c25b3cff63d8fdcd12ca70f6fd0a36efe70`.
- Runtime SHA-256 `f4c6ee1a63f62bc3fafe740237fe6692823d7481e3c3a3f50592584df604daf8`.
- Installer-source SHA-256 `0ef9f7d85175c6a1ad45ca54db99f263a08759ef6251134e058539e952dfc9bd`.
- Core deterministic tests 29/29 PASS.
- Regression lock 31/31 PASS.
- JS syntax core/background/runtime/popup/installer PASS.
- Mock update from 14.1.1-shaped unpacked extension -> 14.2.0 PASS; key preserved in fixture; pre-activation authority correct.

## Important corrections discovered during this checkpoint
1. Earlier local V14.2 draft still had overlapping-window math (`order*5`). Fixed locally to `order*(width+gap)`; on 1920 workArea positions are NV02 left=1411, NV04=902, NV05=393, exact 5px gaps.
2. Earlier local seed incorrectly had NV04/NV05 runtime-active. Fixed locally: NV02 only active; NV04 specialized pending; NV05 pending.
3. Added migration v2 so an experimental stale V14.2 registry cannot silently retain background elevation.
4. Current PR #442 head `3601be70...` is stale/failed: CI run 33954225702 failed Typecheck because `tests/auto-worker-v14.test.ts` imports JS without declarations; Vercel Existing TigerIQ gates also failed. Do not use old DEV_GATE_PASS claims for this head.

## Not physically verified
PC01/Chrome physical install/reload of 14.2.0, no-reopen-loop observation, exact multi-window placement, archive-before-close, routing E2E `2/4/5`, restart/crash/lease/governor and NV01 preempt/yield remain open. Before activation, physical routing acceptance is: `2` -> NV02 current CENTRAL queue; `4` -> NV04 specialized/non-background; `5` -> `COMMAND_PENDING_ACTIVATION`. Do not claim PHYSICAL PASS or activate NV04/NV05 without evidence.

## Safe next action
Take over from this checkpoint, first verify branch/SoT freshness and whether exact local V14.2.0 source/artifacts are available. If available, do not rebuild: run installer/machine gate and fix only new findings. If only GitHub is available, reconstruct only the uncommitted V14.2 delta above from V14 source, fix stale Typecheck test without weakening coverage, commit on this successor branch, run exact-head CI/Queue/Vercel gates, then physical test. No MAIN/Production/paid/security/reboot mutation.
