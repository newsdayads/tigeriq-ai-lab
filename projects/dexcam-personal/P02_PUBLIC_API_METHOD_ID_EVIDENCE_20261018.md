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


## Follow-up repair evidence — inconsistent ZIP local vs central DEX headers (18/10/2026)

**Found after the original P02 method-ID audit:** The private **standalone audit prototype**, not this repository document, accepted four crafted ZIP inputs in which the local DEX header contradicted the central-directory entry. Its first ten checks did not cover that class of error. This is an offline input-integrity failure, **not** evidence that UltraCar v240 itself is compromised.

**New observed RED:** \`node --test tests/dexcam-personal/p02-apk-api-audit.test.mjs\`, on the previous prototype plus five newly authored synthetic checks: **11/15 PASS, 4/15 FAIL**. The rejected-by-policy but previously accepted cases were local compression-method mismatch, local encryption-bit mismatch, forged local CRC, and forged local uncompressed/compressed size.

**Bounded fix in the exported standalone prototype:** after reading a local ZIP header, require the local general-purpose flags and compression method to agree with the central entry. When bit 3 (data descriptor) is **not** set, also compare local CRC and both sizes. With bit 3 set, allow absent local CRC/sizes and continue verifying actual decoded size and CRC from the central record. A new positive synthetic test includes a **real signed data-descriptor record**, not merely a flag with missing bytes.

**New observed GREEN:** **15/15 Node tests PASS, 0 FAIL** on the patched local source. Re-running the patched tool against the **same original private APK** succeeded and preserved source SHA-256 \`6e1717d4df469c4c9fb8639d1f4cd4a8eb431b270b0521326250dcb2c89bde7f\`, method IDs \`61410\`, and category counts \`USB=32, CAMERA=14, WINDOW=10, RENDER=38\`. This real-APK sanity readback is **not** an Android runtime test. A matching five-case Vitest suite was authored, **not run in repository CI**, because the standalone parser and test fixtures are distributed **only in the user-conversation ZIP**, not committed here.

**Repaired offline bundle:** \`DeXCam_P02_ZIP_Header_Repair_20261018.zip\`; SHA-256 \`649ff2cc8b619992d24270d75fa189b3008edf934e77eb978552b7e724478df7\`. Parsed source file SHA-256 \`092b97509046a6d7844faf88c97fbab7e0aa1f53f1d6b8315c2e8a40bace792c\`. Included logs: \`RED_ZIP_HEADER.txt\`, \`GREEN_ZIP_HEADER.txt\`; ZIP CRC and per-file manifest hashes verified. The archive **does not contain** the private reference APK, vendor DEX code, device IDs, license data, or credentials.

**Strict acceptance boundary:** This is an **offline prototype regression repaired and verified in the current conversation**, not a production/PC01 REA parser release and not repo-CI acceptance of that parser. GitHub checks for this documentation file, if successful, prove only this documentation diff. Native P01 REA on the authorized PC01 lane, actual USB/DeX/R observations, and product milestones C01–F05 are still unaccepted; \`DONE=false\`, checklist **11/30**.
