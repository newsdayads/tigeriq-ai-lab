# UltraCar V1 — Native Compose quick-layout row (source candidate)

Owner's approved physical DeX layout: in **the same UltraCar Home card**, put 5 equal-width quick layouts directly between **KHỞI ĐỘNG** and the existing **Bố cục đã lưu / Bố cục mới / Camera** actions. Equal horizontal margins, **transparent row and cells**, no dark strip, popup, floating sibling window or spillover into the adjacent media panel.

## Code delivered

- `UltraCarHomeQuickLayouts.kt`: a true Compose `Row` with five equal weights, 8dp outer gutters and 6dp internal gaps, normal Column measurement, tap to launch session ID and long press to reassign; persists legacy `tigeriq_v44_quick_slots/slot_0..4` IDs without reseeding.
- `UltraCarHomeControlColumn` shows the intended integration order: original START composable, shortcuts, original bottom actions. **The host Home composable must actually call it**. Do not attach a `FrameLayout` overlay, `Dialog` or `Popup`.
- Static source contract test: `node --test tests/ultracar-v57-native-compose-candidate.test.mjs`.

## Explicit integration gate — NOT DONE YET

The currently installed V1 is a compiled, obfuscated APK. The repository does not contain a verified editable Kotlin implementation of its real Home Compose call site. The prior v57 `V44UiBridge.java` still attaches an overlay to `android.R.id.content`; adding this Kotlin file to GitHub **does not modify the installed APK**.

A properly authorized native-APK integration must: identify original Home composable; bind these inline UI slots to the real existing session IDs/icons and callbacks; retain start/bottom buttons and saved card drag logic; remove overlay quickbar but retain six card grips where required; compile Android sources and test on actual SM-F916N DeX. Kotlin compilation/integration, physical runtime and owner acceptance have NOT been verified.

The v57 local isolated stage also still declares code297/name v56. Prior denied PC01 version metadata/runner file mutations **must not be retried through another account or tool**. Only a genuine provider-authorized host write permits further TEST packaging/signing and the existing interactive Drive task.

**Status:** NATIVE_COMPOSE_SOURCE_CANDIDATE only; NOT app-fixed, NOT signed, NOT Drive-published, NOT DeX-accepted. Production and Camera baseline unchanged. Ref #5129.
