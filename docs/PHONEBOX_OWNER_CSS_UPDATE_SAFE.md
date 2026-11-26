# PhoneBox Owner CSS — Update-Safe Mobile Layout

OWNER_DIRECT=2026-11-23 | RUNTIME=PC01 | STATUS=DEPLOYED_PC01_PENDING_DEVICE_ACCEPTANCE

## Purpose
Keep user-specific responsive PhoneBox layouts separate from upstream `ersinkoc/phonebox`. A regular vendor update must not overwrite owner CSS or change original saved widget geometry.

## Canonical override files
- `apps/phonebox-web/owner-overrides/zflip7-portrait.css`: portrait mobile, two-column compact cards; full-width charts/GitHub/sessions; quotas stacked with smaller rings; no fixed 1180px mobile grid.
- `apps/phonebox-web/owner-overrides/zflip7-cover.css`: Z Flip cover display, two-column and bottom camera clearance.

Runtime owner files on PC01:
- `D:\TigerIQ\Apps\PhoneBoxWeb\assets\zflip7-portrait.css`
- `D:\TigerIQ\Apps\PhoneBoxWeb\assets\zflip7-cover.css`

These are loaded **after** the upstream `/panel/style.css` through the existing authenticated **view gateway** `D:\TigerIQ\Apps\PhoneBoxWeb\server.mjs`, never by modifying the upstream repo. Owner CSS media queries are scoped by viewport:
- Portrait: `max-width:700px`, `min-height:541px`, orientation portrait.
- Cover: `max-width:650px`, `max-height:540px`, `min-aspect-ratio:.82`.

## Upgrade contract
1. Back up the deployed owner CSS and gateway server before changing upstream PhoneBox.
2. Update the vendor upstream in its own checkout. Never write owner overrides into upstream `style.css`, `main.js`, Android app, or saved widget layout.
3. Keep the gateway CSS injection active (append cover then portrait), and verify returned `/panel/style.css` contains both.
4. Verify Node syntax, gateway tests, authenticated HTTPS website, owner auth, portrait and cover viewport layouts before accepting the upgrade.
5. If upstream widget class names or DOM change, adapt owner overlay through a TigerIQ branch/PR/CI, rather than patching vendor files.

## Evidence
PC01 gateway Node tests 4/4 PASS, isolated HTTP style.css returned 200 and contained both owner overlays; production /healthz returned 200; upstream Git checkout had no uncommitted changes. Physical cover/portrait screenshots after this patch still require owner acceptance.

No APK rebuild required; TWA APK fetches the gateway website CSS online. No phone-side Tailscale.

## Owner quota rotation (PhoneBox v0.9.30, 26/11/2026)
- Home Codex and Antigravity rings rotate available five-hour/weekly windows every five seconds, using the existing panel tick and live quota data. Antigravity cycles Gemini and Claude/GPT windows; other pages remain unchanged.
- The owner-quota-rotation.mjs overlay transforms only the served widget module. Changed upstream anchors fall back to original source. Presentation is in owner-overrides/owner-quota-rotation.css. No APK rebuild or phone VPN.
- PC01 Agent and USB app upgraded via vendor updater to 0.9.30; vendor ZIP SHA-256 matches release, original config SHA-256 unchanged, local vendor checkout clean at v0.9.30. Seven automated tests and isolated gateway HTTP overlay check passed. Physical Z Flip/iPhone acceptance remains pending.
