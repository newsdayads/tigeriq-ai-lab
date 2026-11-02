# TigerIQ Camera v1.0.11 TEST ? source and acceptance
- Original UltraCar v1.0.17: USB presence poll 350 ms and explicit reverse gear broadcast, inspected locally.
- Independent code implementation; no proprietary decompiled Java/Smali copied.
- Adds vendor camera detection for video names, class-239 and vendor-specific isochronous descriptors.
- Prevents numeric gear extras from throwing ClassCastException; null USB event ignored.
- Logs background launch rejection. Does not claim Android background-launch restrictions are solved.
- Real R signal, DeX automatic popup and Samsung Z Fold 2 connected hardware NOT verified.
- Parked-vehicle QA required: true R opening and P/D/N closing, repeated cycles, no unsolicited popup.

# v1.0.12 TEST ? based on user in-car video IMG_8395.mp4 (02 Nov 2026)
- Screen recording: launcher icon opens settings window, while camera can open separately; gear R operation not proven to auto-open.
- Root cause in source: MainActivity had MAIN/LAUNCHER, and CameraActivity was a separate launch target.
- Launcher now goes directly to CameraActivity. MainActivity is settings-only, explicitly opened via Camera Settings or floating-button long press.
- MainActivity Open Camera finishes settings task; remove auto USB attach activity launch to prevent duplicate triggers and system chooser.
- USB watcher baseline camera-present is NOT an R event and cannot auto-open at startup.
- Physical gear state remains unverified. Watcher detects physical USB transitions, not CAN/gear R; if USB remains connected when R changes, software needs a trusted separate signal source.
- No driving while testing. Parked-vehicle real Fold2 DeX R/P/D QA remains required before closure.

- Diagnostics (settings screen): show last reverse broadcast and last USB-presence change separately. A simulated broadcast is not proof of gear R. USB enumeration is not proof of gear R.
