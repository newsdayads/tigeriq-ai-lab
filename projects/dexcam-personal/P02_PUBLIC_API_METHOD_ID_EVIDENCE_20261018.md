# DeXCam P02 — Android Public API Method-ID Evidence (18/10/2026)

**Work Order:** [#4625 - DeXCam Personal](https://github.com/newsdayads/tigeriq-ai-lab/issues/4625)
**Purpose:** a newly verified method-ID reference audit for FR/NFR feasibility, not a claim of native REA execution or working Android/DeX functionality.

## Genuine input and distinct technique

- Input: Owner-controlled original UltraCar v240 APK, kept private. The original APK, DEX bytes, internal class names, original method bodies, local paths and private device identifiers are **not** included in this repository.
- Size: 34,121,912 bytes; SHA-256: `6e1717d4df469c4c9fb8639d1f4cd4a8eb431b270b0521326250dcb2c89bde7f` (matches previously verified P00 input).
- Procedure: read the ZIP central directory, validate DEX ZIP-member CRC, parse DEX `string_ids`, `type_ids`, `method_ids` and `class_defs`, then count allowlisted **Android platform API method references** from the method-ID tables. Unlike the previous ZIP integrity and DEX-string precheck, this detects actual typed method-ID references. It does **not** decode an application call graph or demonstrate that any method was invoked.
- Observed structure: 1 `classes.dex` member, **61,410 DEX method IDs**, **10,845 declared classes**. Counts may include bundled libraries: do not attribute all references to the proprietary application author.

## Newly observed Android platform API references

| Allowlisted platform API category | Method IDs in DEX |
|---|---:|
| `android.hardware.usb.*` | **32** |
| `android.hardware.Camera`, `camera2.*` | **14** |
| `ActivityOptions` and `WindowManager` | **10** |
| `MediaCodec`, `SurfaceTexture`, `Surface` | **38** |

Individual **public Android API** method-reference presence (not calls): `UsbManager.requestPermission`, `UsbManager.openDevice`, `UsbDeviceConnection.controlTransfer`, `UsbInterface.getInterfaceClass`, `Camera.open`, `ActivityOptions.setLaunchBounds`, `ActivityOptions.setLaunchDisplayId`, `SurfaceTexture.updateTexImage`.

## Practical conclusions and acceptance boundary

- **FR-001/002:** USB discovery/permission/transfer **references** exist, but no actual USB VID/PID, UVC interface enumeration, grant result or live camera stream is verified.
- **FR-008/009:** `setLaunchBounds` and `setLaunchDisplayId` references are **not proof** that One UI/DeX honors the requested bounds or allows arbitrary resizing of an already-running third-party task. Device/OS capability and applied bounds remain UNKNOWN.
- **FR-006:** render/codec references are **not** evidence of first-visible-live-frame; image freshness, display and USB latency are still NOT_MEASURED.
- **FR-003/005, NFR-001/002:** no verified R_ON/R_OFF source, device observations, 5/50 physical cycles or latency measurements. Negative method-ID results cannot rule out code reached by JNI, reflection or dynamic loading.
- **Native P01:** `rea inspect-android-package` on authorized PC01 has **not** run on the private APK. This audit is explicitly **not** substituted for a REA device/tool receipt.

## Repeatable, private evidence verification

An offline Node.js standard-library-only prototype was run locally against the privately retrieved exact-hash APK. Its output allowlists public Android API counts/booleans and never emits vendor classes or local file paths. **10/10 synthetic Node tests PASS** on stored/deflated ZIP, CRC mismatch, encrypted member, invalid DEX, missing DEX and sanitized errors; a separate 6-test Vitest suite was authored but **not run on GitHub CI** for this private prototype. Its binary-free distribution and sanitized JSON were produced in the current conversation, not attached to public GitHub. Do **not** imply this markdown file includes its source.

OFFLINE_PRIVATE_BUNDLE_SHA256=`542ec2be93abfe31f8c4fa22e1bf00fb4b8a19ebddfd6c14571fe68020101d57`
OFFLINE_SOURCE_FILE_SHA256=`282ac1794b14d936d3a1eb45a77ebdd52f25fb67f22d326174d7a4ab5deb4757`
OFFLINE_SANITIZED_JSON_SHA256=`0edc54c9b2067d4773ebc761b5bd10bc3b0182af50b15d4aebac3c5b5f312cf9`

**Checkpoint:** P02 method-ID structural evidence verified only. `P01_NATIVE_REA=NOT_RUN`; `C01_F05=NOT_ACCEPTED`; `DONE=false`; progress **11/30 unchanged**. Next executable input for full P01 is an authorized native REA PC01 lane and private APK tool receipt. No PC01/RDC/App Chrome/vehicle action, source copying, release, paid or security mutation in this audit.
