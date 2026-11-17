# GH-5135 — Fail-closed screenshot gate for Android virtual secondary display
Work Order: GH-5135. Source baseline: V2 main after PR #5733, `05d30d2535388ddc73b3cf19b394b1ea20347e97`.

## SPEC and acceptance
The previously accepted 31/31 Android instrumentation checks do not reliably prove visible output on the *secondary* display. The shell sometimes reuses an existing QA Activity on the phone and returns a **flat grey screenshot**, while Android tests still pass. An external QA harness must reject a flat screenshot before any visual QA can PASS. Run only on an authorized S10 and an isolated QA package `ai.tigeriq.ultracarhcm.v2.vqa`.

1. RED: known bad captured screenshot `gh5135-v1v2-vector-vqa-simdex-20261117-home.png` (1920×1080) has **1** sampled color, luminance stddev **0.00**, mean 48, screenshot SHA256 `FDE1F1FB9AC1F96CB9387002587C2EC869A1C684DB3B293D243DBF970360E7A1`. Gate MUST reject.
2. GREEN reference: screenshot after fresh dedicated-task launch `gh5135-v1v2-visual-quickbar-fixed-fullqa-20261117-secondary-home.png` (1920×1080) has **894** sampled colors, luminance stddev **59.30**. Additional accepted QA screenshots: 1600×900 (637 colors, stddev 66.57) and 1280×720 (383 colors, stddev 65.93). Gate MUST accept these **as non-flat evidence only**, not as visual parity.
3. Capture must use ADB `am force-stop` on **only** isolated QA package, then `am start -W --display <id> -f 0x18000000`, verify `Display #<id>` resumed Activity belongs to that exact package, and capture with `screencap -p -d <id>`. Do not consider `am start: Status ok` alone sufficient.
4. Validate screenshot dimensions and sampled richness (at least 96 distinct colors, luminance stddev at least 12), persist source output and SHA256, and return exit code 2 for an unmet criterion.
5. Snapshot Android `overlay_display_devices` (must be `null`), temporarily set a whitelisted profile, and **always** `delete` and verify restore even after a failure.
6. No V1 or existing V2 install/force-stop, no private source code/assets import, no runtime permission changes, no signer bypass, no production APK release. Samsung DeX physical acceptance still requires DeX hardware.

## Evidence contract
`MODE=ImageOnly`: file-based RED and GREEN probes, no device mutation.
`MODE=VirtualDevice`: one actual S10 image + Android display/task receipt + rollback attestation. These do not replace actual hardware QA F01–F22/D01–D10.
