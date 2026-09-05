# TigerIQ Auto Worker V13.4.9 — Next-turn ACK + 20s self-heal

Parent: #306
Branch: `auto-worker/v13.4.9-source`
Status: BUILD/STATIC/MOCK PASS — PHYSICAL CHROME RETEST PENDING

## Physical finding
V13.4.8 can show `Lượt 8 đã xác nhận · phản hồi trước đã tiêu thụ` and then sit for >5 minutes without issuing the next `2`.

## Root cause
The outer next-turn gate ignored the boolean return value of `dispatch2()`. A reconcile-only increase of `state.turns` could satisfy `turns > turnsBefore`, causing the current assistant fingerprint to be consumed even when no NEW command `2` was submitted. Once consumed, later ticks skipped it forever.

## V13.4.9 correction
- Capture `dispatched = await dispatch2('RESPONSE_COMPLETE')`.
- Consume assistant fingerprint only when **this dispatch call returns true**, `turns` increased, and `lastDispatchAt >= dispatchStartedAt`.
- If dispatch is unresolved, keep fingerprint pending and retry through existing anti-duplicate/bounded-submit guards.
- Add **20s self-heal** for stale/migrated V13.4.7/8 state: if the latest stable assistant still equals the consumed fingerprint, no dispatch is pending, and no newer dispatch progressed for 20s, clear the consumed fingerprint and retry.
- Preserve fast missing-composer reload 12s/max3.

## Locked baselines — DO NOT REWORK
- Window `504×834 / Top5 / Right5` = PHYSICAL PASS / LOCKED.
- Tiger/countdown size retained.
- Status panel default hidden; Tiger toggle retained.
- Exact Project/readiness/submit reconcile/Pause-Stop/tail/watchdog retained.
- Installer does not auto-open Chrome.

## Release identity
- Installer: `TigerIQ_AW_13.4.9.cmd`
- Installer SHA-256: `5ce47f26d4d047c31e0e127a76f75cf4d901495bdaaa52a3d86b66acda4df928`
- Source/tests: `TigerIQ_AW_13.4.9_SRC.zip`
- Source/tests SHA-256: `6c7e2cb2880d6b21c36b6f96bbeab3473b92a6b0992393f25d6b85fc3981139d`
- Runtime SHA-256: `0ed8039d0ea83697592f3751231ff4f6f6cf78b7871140063ffe0b69c7a8f411`
- Background SHA-256: `2cb9ac6db7de8c2d195bc7857c3898789fc28049f3ba807026aeadb455fa0255`
- Installer source SHA-256: `d06c7674a2958cfed234308036e5450325e02f9831a5a9f6214856bc5ec31aa9`

## Evidence
- Regression lock: **15/15 PASS**.
- Node syntax background/runtime/popup/installer: **PASS**.
- Mock V13.4.8 → V13.4.9 install: **PASS**.
- Extension key preserved in mock install: **PASS**.
- CMD max line: 447 chars.

## NV02 no-rework rule
If CENTRAL/#306 shows V13.4.9 with the hashes above, NV02 must **SKIP rebuild/repatch**. Only physical Chrome verification or a new physical defect can reopen implementation work.
