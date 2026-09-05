# TigerIQ Auto Worker V13.4.6

Status: OFF-MAIN candidate for physical Chrome acceptance.

## Canonical release identity
- Candidate: `V13.4.6`
- Installer artifact: `TigerIQ_AW_13.4.6.cmd`
- Installer SHA-256: `40cc9b2afa881750e93965e7cdf03f5921d7d1a240a9b3a643d58c605f6cb23d`
- Source/test bundle: `TigerIQ_AW_13.4.6_SRC.zip`
- Source/test bundle SHA-256: `87211d43cd14221f8b9d5728654946d155d641da7cd28c3c59a8725dace1280d`
- Canonical installed extension path contract: `C:\TigerIQ\AutoResumeV6\extension` when present; installer otherwise resolves the exact active Chrome extension source fail-closed.

## Fixes completed in this candidate
1. `BỊ CHẶN SUBMIT`: submit confirmation now accepts multiple strong physical signals (`USER_2_COUNT`, new user-2 node/turn, generation start, new assistant response) instead of relying on one DOM counter only.
2. Resend is bounded to max 2 attempts after a 30-second ambiguity guard; after that it blocks to avoid duplicate command `2`.
3. Readiness timeout now persists predicate diagnostics and resets accumulated navigation failures after a successful ready state.
4. Tiger icon enlarged to 36×36 CSS px; countdown enlarged to 68×34 minimum with 13px font.
5. Status panel remains closed by default and only toggles on Tiger click.

## Locked physical baseline — DO NOT REGRESS
- Managed window exact `504×834`.
- `Top=5px`, `Right=5px`.
- Exact TigerIQ AI Lab project route unchanged.
- Tiger toolbar icon, Khoa/NV02 identity, anti-duplicate, pause/stop authority, lifecycle, watchdog and tail semantics remain locked.

## Evidence
- Regression lock: `17/17 PASS`.
- JS syntax: background/runtime/popup/installer PASS.
- Mock update V13.4.5 → V13.4.6 PASS.
- CMD embedded payload exactly equals tested installer source.
- CMD max line length: 447 chars.
- Installer does not auto-open Chrome.

Physical Chrome acceptance is still required before runtime DONE.