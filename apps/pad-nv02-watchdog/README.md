# NV02 PAD Watchdog

Owner-authorized prototype for issue #1710.

## Purpose

Reduce normal-path dependence on ChatGPT/Desktop Commander by letting a local Power Automate Desktop flow supervise NV02 from the canonical local Controller state.

## Safety model

- Default `ActiveMode=false`.
- WORKING or busy UI => no action.
- READY is actionable only when Controller/bridge/session are healthy, GPT-5.6 Sol High is exact/ready, no security/chat-load block exists, and the active `APP_CHROME_SELF_RUN` job identity matches its GitHub issue.
- Active mode does **not** call the generic `/dispatch` endpoint, which would create a duplicate active UI job. It only marks the existing continuity state due; the reviewed bridge/controller guardrails retain ownership of the actual natural continuation.
- No Production cutover is part of #1710.

## PAD flow

PC01 flow: `TigerIQ_NV02_PAD_WATCHDOG_R1_CLASSIC`

Single PAD action:

```powershell
& 'D:\TigerIQ\Automation\NV02-PAD-Watchdog.ps1' -ActiveMode $false -Cycles 3 -PollSeconds 5
```

Evidence log:

`D:\TigerIQ\Evidence\pad-nv02-watchdog-r1.jsonl`

## Validation

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\TigerIQ\Automation\NV02-PAD-Watchdog.ps1 -SelfTest
```

Expected: `SELFTEST_PASS`.

2026-09-24 live canary: three consecutive cycles observed NV02 WORKING on issue #1528 and returned `WORKING_NO_ACTION`; no dispatch/job switch occurred.
