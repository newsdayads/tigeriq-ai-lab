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

# v1.0.13 TEST ? bounded offline event recording and user-controlled share
- Local-only, app-private bounded camera_events.log (128 KiB rollover); no camera frames or location.
- Instrument source: gear broadcast arrival and parsed R_ON/R_OFF, service dynamic broadcast, USB device attach/detach, USB presence baseline/transitions, attempted window launch, Android launch exception type, window visible lifecycle, and close reason.
- Settings has XEM LOG and G?I LOG Android share-sheet buttons; user initiates sharing, there is no auto-upload.
- If no R event and USB does not change on a parked vehicle, the app cannot infer the actual selected gear. A physical signal bridge or verified original source is required; do not treat simulation as vehicle QA.

# v1.0.14 TEST ? feedback from owner
- Buttons were only sending implicit broadcasts and claiming success without proof. Foreground buttons now invoke CameraActivity directly; logs distinguish manual testing from gear events.
- Settings window closes after successful accepted launch, not before. P test directly requests close.
- CameraActivity no longer closes just because initial USB enumeration is empty. Actual USB transitions and R broadcasts remain logged.
- This fixes diagnostic button logic, not unverified vehicle R/P detection. Requires separate parked-vehicle QA of actual gear signals.

# v1.0.15 TEST ? faithful UltraCar USB trigger port
- Directly decompiled original UltraCar v1.0.17 TigerIQBridge and separate v1.0.73 APK.
- v1.0.17 has ANY USB device considered present (method falls through to true), 350ms watcher, 400ms delayed open, immediate disconnect close and pending-open cancel.
- v1.0.73 disables auto-open and ignores R broadcasts, so it cannot be used for auto-open behavior.
- Standalone service now adopts v1.0.17 USB inventory logic, single writer for USB UI events; USB receiver only wakes watcher.
- USB transitions are NOT a true car gear/CAN signal. Physical Z Fold 2 and camera on car still require parked vehicle testing; no production acceptance is claimed.

# v1.0.16 TEST ? correct the overbroad USB signal mistake
- v1.0.15 any-USB detection can be permanently true on a DeX hub and cannot then detect R/P. v1.0.16 tracks per-device USB add/remove, learns USB VID/PID from a UVC Camera actually opened manually, and gates automatic window to that camera. Fallback for a newly attached single unknown USB device (even when a DeX hub is already present), excluding HUB/HID/STORAGE USB interfaces.
- Event log includes per-transition USB inventory counts/VID/PID (no serial IDs), physical trigger and actual CameraActivity visible/not-visible check 1.5s later. startActivity dispatch does not count as visible.
- This remains USB-presence detection, not physical CAN gear state. It cannot detect gear shifts if the real USB camera remains enumerated through R/P.
