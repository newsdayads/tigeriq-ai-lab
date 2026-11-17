# GH-5135 F10 — DeX 3×3 QuickBar visual defect
SPEC-FIRST: Based on two **actual S10 simulated secondary-display** screenshots, not speculation. On the x=5–95%, y=56–78% viewport strip, the existing V2 QuickBar has **0.5708** near-white sampled pixels; auxiliary V1 Build362 has **0.0332**. V1 Golden Build369 still requires separate physical acceptance.

- Preserve exactly 9 functional Android Compose slots, three rows of three, app-launch/Camera and long-press edit, callback/backup semantics.
- Replace default opaque white Material3 Surface with contrasting translucent **dark cards**, subtle cyan edge/icon and small readable text; ellipsize long titles and avoid narrow-row clipping on 1280×720.
- Android S10 real QA expected: after clean isolated `.vqa` install, all existing instrumentation tests pass; screenshot must belong to the requested **simulated** secondary display (not real Samsung DeX), be non-flat, and white-pixel fraction in the same viewport strip must be < 0.10. Restore display setting.
- No V1 asset copied, no user app replacement, no permission change, no OTA APK publication.

## Verified scope on S10, 17 Nov 2026
- Source revision: `37d829ed56f305adbf7a602ae2d6ac1b9747e9ef` (local QA package suffix, source code otherwise unchanged).
- Native Android Gradle/JUnit and AndroidTest APK build PASS; log SHA256 `36C668694ECEBF1FB44188AE37AD3D324C89E4240B893F06AE13432AA9DB5E6F`.
- Android real S10 isolated QA: **31/31** instrumentation tests PASS, evidence SHA256 `375108A2B0FAF1451950B4138DFAE675374D6EE316BE6D381EEB70460417C3D6`.
- Secondary 1920×1080 simulated-display screenshot: task & display identity PASS, screenshot SHA256 `B851061FEB7CBB17D81A28B87800F4D0E79EA0CA379D0CE7099DD6310A22145A`, 920 sampled colors, non-flat image gate PASS.
- **Same region, pixel threshold, same device:** V2 white fraction `0.5708` → `0.0017`; source/scene correction evidenced in `D:\TigerIQ\Evidence\gh5135-f10-darkbar-white-card-pixel-regression-20261117.json` (SHA256 `8CE2EAA67160829DB98C92EEB9B2A639DE43EE73FE0BBD53F8613C0C23458FF3`).
- Android simulated overlay setting restored to null. **Visual test is not functional click/long-click acceptance on physical Samsung DeX.**
