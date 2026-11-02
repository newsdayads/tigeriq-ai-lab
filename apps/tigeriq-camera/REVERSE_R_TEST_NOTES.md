# TigerIQ Camera v1.0.11 TEST ? source and acceptance
- Original UltraCar v1.0.17: USB presence poll 350 ms and explicit reverse gear broadcast, inspected locally.
- Independent code implementation; no proprietary decompiled Java/Smali copied.
- Adds vendor camera detection for video names, class-239 and vendor-specific isochronous descriptors.
- Prevents numeric gear extras from throwing ClassCastException; null USB event ignored.
- Logs background launch rejection. Does not claim Android background-launch restrictions are solved.
- Real R signal, DeX automatic popup and Samsung Z Fold 2 connected hardware NOT verified.
- Parked-vehicle QA required: true R opening and P/D/N closing, repeated cycles, no unsolicited popup.
