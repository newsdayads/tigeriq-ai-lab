# TigerIQ Auto Worker V14.0.0 — Multi-Employee Scheduler

Parent baseline: #306 / V13.4.10. Status: OFF-MAIN candidate; build/static/mock only until physical PC01 acceptance.

## Architecture
- One Chrome extension/app, one managed window, multiple employee tabs/profiles.
- Registry-driven profile adapter; scheduler core does not enumerate a fixed worker count. Registry can add NV06/NV07 without changing scheduler algorithms.
- Active AUTO profiles: NV02 Khoa, NV04 Khải, NV05 An. NV01 is foreground priority only. NV03 remains disabled/paused.
- Per-employee queue/state/checkpoint/heartbeat/current-work/resource claims; shared global queue and lease table.
- One active owner per resource via TTL lease + heartbeat; stale lease recovery is bounded.
- Resource governor samples Chrome `system.cpu` / `system.memory`; default max two heavy executors, soft/hard reductions, owner-foreground heavy slots=0.
- NV01 foreground triggers graceful yield: finish safe atomic step, snapshot/checkpoint, release lease, `NHƯỜNG_NV01`; automatic resume after resource becomes free.
- Cross-review preference: NV02 -> NV04, NV04 -> NV02. NV05 coordinates/product plans but does not self-review implementation.
- `BLOCKED != IDLE`, dependency watcher, bounded retry/backoff; near-empty queues refill only one cycle per AUTO employee.
- UI shows factual heartbeat/state/current work/resource/next condition, per-employee Pause/Resume, Pause All, governor and owner-foreground status.

## V13.4.10 baseline preserved
- Locked window 504×834 / Top5 / Right5.
- Exact TigerIQ AI Lab Project readiness; missing composer fast recovery 12s/max3.
- Bounded submit/reconcile max2; explicit next-turn ACK + 20s self-heal.
- Tiger/countdown and default-hidden status panel behavior.
- Pause/Stop authority, anti-duplicate, lifecycle/watchdog.
- Real ChatGPT Archive-before-close: local backup -> Archive UI -> Archive ACK + snapshot verify -> close; fail closed keeping tab open.
- Installer update-over with backup/rollback; preserves extension key/state; does not auto-open Chrome.

## Security/authority
- Host permission remains only `https://chatgpt.com/*`.
- No GitHub/Production/Vercel mutation APIs in extension runtime.
- No local model activation; NV03 remains paused.
- No runtime CMD/PowerShell/notification popup.
- `system.cpu` and `system.memory` are read-only governor inputs.

## Tests
- User acceptance matrix: 20/20 local deterministic tests.
- Baseline + architecture regression lock: 46/46 static checks.
- Node syntax checks: core/background/runtime/popup/installer.
- Mock update-over test: PASS; key preserved; payload exact 10/10.

## Physical gates still required
1. Chrome shows V14.0.0 and state migration from V13.4.10 is intact.
2. Window stays 504×834 / Top5 / Right5.
3. NV02 alone reproduces old behavior with no baseline regression.
4. NV04 and NV05 run independently in the same single app window; no resource conflict.
5. NV01 foreground causes yield/checkpoint/release and later resume without duplicate/lost evidence.
6. Real CPU/RAM pressure reduces concurrency without noticeably slowing owner foreground UI.
7. Crash/restart/lease recovery works on PC01.
8. Real Archive-before-close works for each profile.
9. Registry/command 5 resolves in NEW CHAT after dynamic SoT update.

## Hashes
- Installer `TigerIQ_AW_14.0.0.cmd`: `96af9cbfad1d69225d9f85bd56f1a119503f53208c677993197c4d6fd9f9207d`
- Source ZIP: `22ea479c1d99cc99bb64e7e7ffee426937a0164c72c15f41df3fc61f4402af43`
- Core: `136b01c3f880f21a4c60dbb42607b03e80fdaef9597224e26e7083d757cb540c`
- Background: `c65b8524b81c116e90671a8452c948c941624b5308d559052505c7ca78aa03ab`
- Runtime: `4544cbb6952db83acd42ace7ff4a17cd65041591108bde2dfd693677dc48a7b0`

No MAIN/Production/reboot/paid/credential/security widening is performed by this candidate.