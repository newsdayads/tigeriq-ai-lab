# TigerIQ Auto Worker V13.4.7 — Next-turn stall fix

Parent: #306
Branch: `auto-worker/v13.4.7-source`
Status: BUILD/STATIC/MOCK PASS — PHYSICAL CHROME RETEST PENDING

## Physical finding
V13.4.6 can remain at `PHẢN HỒI ĐÃ ỔN ĐỊNH / Chuẩn bị lượt tiếp theo` without issuing the next `2`.

## Root cause
Runtime consumed `lastConsumedAssistantFingerprint` **before** the next `dispatch2('RESPONSE_COMPLETE')` was physically confirmed. If that single dispatch path returned false because of any transient readiness/composer/send/pending-confirmation condition, the stable assistant fingerprint was already marked consumed, so later ticks skipped the retry forever.

## V13.4.7 correction
- Do **not** mark the stable assistant response consumed before next-turn dispatch.
- Capture `turnsBefore`, run the existing bounded `dispatch2()` path, refresh state, and only persist `lastConsumedAssistantFingerprint=a.fp` after `state.turns > turnsBefore` proves the next physical command-2 turn was acknowledged.
- If dispatch is temporarily unresolved, the fingerprint stays pending, so the next tick retries through the existing `dispatchPendingAt` anti-duplicate guard and max-2 bounded resend policy.
- Existing submit reconciliation, readiness diagnostics, Pause/Stop authority, lifecycle/tail/watchdog and exact Project remain unchanged.

## Locked baselines — DO NOT REWORK
- Window placement: **504×834 / Top5 / Right5 = PHYSICAL PASS / LOCKED**.
- Tiger icon/countdown enlarged = keep.
- Status panel default hidden, toggle only on Tiger click = keep.
- Installer must not auto-open Chrome.

## Release identity
- Installer: `TigerIQ_AW_13.4.7.cmd`
- Installer SHA-256: `d41c04055e2e23b41028bf74b819c47cfb2a9e6d8af342588b76a88606bef91a`
- Source/tests: `TigerIQ_AW_13.4.7_SRC.zip`
- Source/tests SHA-256: `d4382acad4f4459130b98a329fd40867e01b28b7606fdfb3dc5606cbc9b4c875`
- Runtime SHA-256: `969c7c623c7dc26e8446bce6d7505a770f4957e0327958aa16a0e36439b2e8b3`
- Background SHA-256: `9a4d0ff45e83d7d93ed4d1a35675d6a204d0e6239429c0aa67c2c9f4507b194e`
- Installer source SHA-256: `7e712503001a5023237295df5fb762f6d46a9609142e897f8e3d32836aef85e5`

## Evidence
- Dedicated next-turn regression: **8/8 PASS**.
- Node syntax: background/runtime/popup/installer **PASS**.
- Mock V13.4.6 → V13.4.7 install: **PASS**; version/key preserved and next-turn ACK gate present.
- CMD max line: 447 chars.

## NV02 no-rework rule
If CENTRAL/#306 shows V13.4.7 with the hashes above, NV02 must **SKIP rebuild/repatch**. Only physical Chrome verification or a new physical defect can reopen implementation work.
