# TigerIQ Auto Worker V13.4.8 — Fast composer recovery

Parent: #306
Branch: `auto-worker/v13.4.8-source`
Status: BUILD/STATIC/MOCK PASS — PHYSICAL CHROME RETEST PENDING

## Physical finding
On exact TigerIQ AI Lab project, ChatGPT can finish loading but omit the composer/chat input. V13.4.7 waits the generic readiness timeout (90s) before reload, which is too slow for this specific condition.

## V13.4.8 correction
- Preserve generic readiness timeout 90s for other predicates.
- When exact Project=true + document complete + composer missing + no visible loading spinner, start dedicated **12s** timer.
- At 12s emit `COMPOSER_MISSING_FAST` and reload exact Project after 500ms.
- Reuse existing bounded navigation failure policy: max 3 readiness failures, then `BỊ CHẶN READINESS`; never sends `2` without composer.
- If composer appears before 12s, fast timer resets and normal stable-readiness verification continues.

## Locked baselines — DO NOT REWORK
- Window **504×834 / Top5 / Right5 = PHYSICAL PASS / LOCKED**.
- Tiger icon/countdown enlarged.
- Status panel default hidden; toggle only on Tiger click.
- V13.4.7 next-turn ACK gate preserved.
- Submit multi-signal reconcile + bounded max2 retry preserved.
- Installer does not auto-open Chrome.

## Release identity
- Installer: `TigerIQ_AW_13.4.8.cmd`
- Installer SHA-256: `50c3cbe93b162f7fcba49574ec29378bf23ac10d9137892c584ab4bf13d121b9`
- Source/tests: `TigerIQ_AW_13.4.8_SRC.zip`
- Source/tests SHA-256: `b7529b260dd8474793774c4566d5950ad4842de7c8f6f87583bc817b6a9fe1a2`
- Runtime SHA-256: `9fb671a22baa4579c6c495fd112ba1eae23c3461dd622b3dadacd7c828ff2a31`
- Background SHA-256: `f4f4c5209e0d6a5a5538ca7eafd12406d3fe56c49985477764dc53db4969a025`
- Installer source SHA-256: `2d672488aa928865c3cf7acab7edfa0fcc18e1d2cab3ba0550c30cec60cdd743`

## Evidence
- Regression lock **11/11 PASS**.
- Node syntax background/runtime/popup/installer **PASS**.
- Mock V13.4.7 → V13.4.8 install **PASS**.
- Extension key preserved in mock install.
- Exact CMD embedded payload = tested installer source **PASS**.
- CMD max line 447 chars.

## NV02 no-rework rule
If CENTRAL/#306 shows V13.4.8 with hashes above, NV02 must **SKIP rebuild/repatch**. Only physical Chrome verification or a new physical defect may reopen implementation work.