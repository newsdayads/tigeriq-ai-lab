# GH-5135 F10 — DeX 3×3 QuickBar visual defect
SPEC-FIRST: Based on two **actual S10 simulated secondary-display** screenshots, not speculation. On the x=5–95%, y=56–78% viewport strip, the existing V2 QuickBar has **0.5708** near-white sampled pixels; auxiliary V1 Build362 has **0.0332**. V1 Golden Build369 still requires separate physical acceptance.

- Preserve exactly 9 functional Android Compose slots, three rows of three, app-launch/Camera and long-press edit, callback/backup semantics.
- Replace default opaque white Material3 Surface with contrasting translucent **dark cards**, subtle cyan edge/icon and small readable text; ellipsize long titles and avoid narrow-row clipping on 1280×720.
- Android S10 real QA expected: after clean isolated `.vqa` install, all existing instrumentation tests pass; screenshot must belong to the requested **simulated** secondary display (not real Samsung DeX), be non-flat, and white-pixel fraction in the same viewport strip must be < 0.10. Restore display setting.
- No V1 asset copied, no user app replacement, no permission change, no OTA APK publication.
