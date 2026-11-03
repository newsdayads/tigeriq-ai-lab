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

# v1.0.17 source-port only ? strict UltraCar broadcast contract
- Source: UltraCar v1.0.17 decompiled ReverseGearReceiver.java; actual parse is exactly action.contains("REVERSE"), state boolean with default false, optional gear string overrides as equalsIgnoreCase("R").
- Source: UltraCar v1.0.17 MainActivity.openCameraWindow()/closeCameraWindow() delegates to TigerIQBridge ViewModel state in original app; that ViewModel is unavailable to a separately packaged Android app. CameraActivity launch/finish is equivalent *intent* but not same implementation.
- Removed guessed alternate gear-broadcast receiver registration from FloatingCameraService, one manifest gear receiver only.
- No proof vehicle ever sends these broadcasts or Gear P/N/D; no on-car acceptance. Do not present this APK or any other as verified physical R/P.

# P0 R-signal feasibility ? UVC video source path (source-only, NOT APK release)
- Actual 4-camera car system feeds a converter box, whose USB video output is connected to Z Fold 2/DeX. USB enumeration staying live across gear R/P would invalidate USB attach as gear detection.
- Original UltraCar APK v1.0.65/1.0.73/1.0.74 does NOT implement verified physical R broadcast; no complete trustworthy gear source yet.
- UVCAndroid 1.0.13 API in local AAR exposes ICameraHelper.setFrameCallback(IFrameCallback,int) and NV21 format: headless/video-signal monitoring can be researched without inventing CAN/Android broadcasts.
- UvcFrameSignalEvidence prototype computes aggregate NV21 luma signatures ONLY, without images/video storage and WITHOUT window automation. A black/static frame could be dark real video or capture card's idle output; it MUST NOT be used as R-off proof by itself.
- Next hardware feasibility: (1) inspect real USB interfaces to check HID/vendor control status from the 360 converter (priority explicit state); (2) if absent, measure video signal characteristics in different states with same monotonic time base; (3) if converter USB provides neither gear data nor reliably observable video state, an independently authorized external trigger is required.
- Acceptance stays FAIL until validated R->ON and P/N/D->OFF in stationary vehicle without false closure in dark or static scenes. No automatic upload, server, device identification or production firmware changes.

# v1.0.18 TEST ? UVC diagnostics wired into running CameraActivity
- Real UVCAndroid 1.0.13 frame callback NV21 emits summary metrics roughly every 2s; no images saved.
- Records last-frame freshness, USB interface classes/subclasses/endpoints at boot and physical USB transitions.
- Cannot observe frame changes while camera Activity is closed. No reliable R/P inferred or automatic closure from black/static frames.
- Release as TEST only. Physical car R/P acceptance remains unverified.

# v1.0.20 TEST ? actual DeX WindowManager overlay and Vietnamese UI
- Owner screenshot of v1.0.19 shows HTTP 403 pairing and background Activity start intent, not proof a Camera window became visible.
- Pairing screenshot entered a code different from the generated owner code; code mismatch can explain HTTP 403. Rotating one-time code after release, with copy support, avoids lockout.
- All visible XML labels and app messages repaired as UTF-8. The previous transliteration / mojibake is no longer acceptable.
- Android Camera now uses TYPE_APPLICATION_OVERLAY hosted by the foreground service for USB event / gear broadcast / bubble / manual test. WindowManager.addView success is logged, rather than trusting startActivity() from background. UVC manager accepts a Context so the service can own the TextureView preview.
- Safety: USB present during cold start must NOT force-open a Camera. Permanently powered USB converter at P is not reverse gear.
- Physical R/P signal is still NOT_ACCEPTED and has no on-device signal proof. Overlay may still require Android overlay authorization; correct gear signal must be verified on Z Fold2 separately.

# v1.0.21 TEST ? Grounded log incident and safe parking path
- Real online Z Fold2 logs (11:47 Nov 03) report WINDOW OVERLAY_OPEN_FAILED UnsupportedOperationException SIX additional times and confirm UVC 1920x1080 preview separately through Activity. USB disconnect ~11:50 is physical device loss, NOT actual gear R/P. No real GEAR R_ON/R_OFF received in downloaded logs.
- Root cause hypothesis, supported by Android Context reference: Service Context has no display; ReverseCameraOverlay.show() used owner Service Context when target DeX display null, then getSystemService(WINDOW_SERVICE); may throw UnsupportedOperationException. Now always resolves a valid default display, creates DisplayContext before WindowContext; records detailed error stage, class and truncated message. Still requires on-device acceptance.
- Replaced phone gyroscope yaw rate -> fake steering curve with safe fixed guide when no verified front-wheel angle. ReversePathGeometry uses bicycle kinematics with wheelbase and wheel envelope: curvature tan(frontWheelAngle)/wheelbase. Curves available only via setVerifiedRoadWheelAngleDegrees (NO ACTUAL STEERING DATA CONNECTED). Pixel mapping currently illustrative, NOT camera calibrated or certified distance measurement. Display explicitly states the warning. Old GuideTrackModel reimplemented through bicycle path, no arbitrary p^2 bend.
- OEM guide-line documentation Mazda/Ford and SAE 2011-26-0095 require vehicle steering source, geometry and camera calibration. An unverified phone gyroscope cannot provide real road-wheel steering. No production driving reliance until real R source + calibrated steering sensor.

# v1.0.22 targeted restoration ? owner-approved style, no unauthorized redesign
- Owner specifically rejected v1.0.21 replacement of original approved 5 OEM visual styles, sizes, labels and rails. Restored the entire v1.0.20 DynamicGuideView Canvas source from exact Git commit 49b2431, preserving 5 designs/color palettes, distance crossbars and approved bottom/top rail sizes (0.30w/0.13w). Change limited to steering provider and curvature math; PHONE gyro removed. Physical-bicycle ReversePathGeometry sample calibrates projected center at 1.5m and 3.0m, used to generate smooth matching quadratic Bezier control points while keeping original width/style; when no verified road-wheel angle, straight stationary guides (cannot physically know curve).
- Confirmed exact real-time log failure from Z Fold2 v1.0.21 at 15:26:20 & 15:40:59: OVERLAY_OPEN_FAILED stage=get_window_manager type=UnsupportedOperationException message=TextureView doesn't support displaying a background drawable. Actual root cause is calling setBackgroundColor(Color.BLACK) ON TextureView, not display context or DeX rendering. Removed it and moved black background to parent FrameLayout, with regression test. Based on AOSP TextureView.setBackgroundDrawable throwing UOE.
- Camera capture sometimes produces flat signal (UVC luma mean 30 variance 0.2) despite UVC stream being available; cannot equate green/flat video to an actual reverse-gear signal without input-state ground truth. This is separate from approved guideline rendering and gear truth.
- No real steering sensor or physical R/P messages verified, so TEST-only; this is not a production-safe calibrated parking prediction.
