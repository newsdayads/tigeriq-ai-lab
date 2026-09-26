# WO-028 — Farm Gateway Adapter Boundary

Status: DONE — REMOTE SOFTWARE/CI VERIFIED

## Delivered
- Typed Farm Gateway boundary for existing ADB/UiAutomator2-style tooling.
- Deterministic `adb devices -l` inventory parsing.
- Online/unauthorized/offline/unknown state and capability mapping.
- Command + argv + bounded timeout runner contract; no shell-string composition.
- Fail-closed app restart and screenshot capture with evidence path constrained under `/sdcard/`.
- Protocol compatibility version `1`.

## Verified evidence
- PR: #88.
- Exact final head: `5d343a28dcf00bfd23872ee5d16582c7f5feb557`.
- CI: run `33332971625` PASS.
- Queue Hygiene: run `33332971736` PASS.
- Vercel Verify: run `33332971696` PASS.
- Branch Preview was READY (`dpl_7VoGqDnEwDFiDu7EDURWpdj8bCKb`) on the preceding code commit; final exact-head verification is represented by the exact-head workflow gates above. No false exact-head Preview claim is made.
- Merge SHA: `53b191935277effe9121c3b807d5617f49d10db3`.
- WO-028 package/test changes did not produce a new Vercel Production deployment during verification. Production remained on WO-027 deployment `dpl_4dQ8ngBi4ogiSraGJBHitkC1bLsQ` and `/api/control` returned HTTP 200 after the merge with queue exactly #57/#58.

## Non-claims
No ADB command was sent to PC01 or a physical device. No live Appium/UiAutomator session, phone control, credential activation or device execution is claimed.
