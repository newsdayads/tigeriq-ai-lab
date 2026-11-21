# TigerIQ PhoneBox Web (PC01)

Two password-protected views, using the original PhoneBox v0.9.26 panel:

- `pc01.tigeriq.io.vn` — read-only panel, original Android WebView HTML/JavaScript and widgets. Mutating calls are blocked; the config endpoint redacts credential keys.
- `phonebox.tigeriq.io.vn` — authenticated reverse proxy to the original local PhoneBox settings UI on `127.0.0.1:8765`. This remains a privileged administration surface.

## Source and licenses

The panel assets come from [ersinkoc/phonebox](https://github.com/ersinkoc/phonebox) tag `v0.9.26` (MIT). Retain `LICENSE` and copyright notices when provisioning the assets. The original agent and Note8 APK remain unchanged.

## Requirements

Node.js 24, original PhoneBox Agent on PC01 `127.0.0.1:8765`, Cloudflare wildcard router, two free localhost ports, and an independent credentials file with JSON shape `{"method":"pbkdf2-sha256","iterations":310000,"salt":"<32 hex>","hash":"<64 hex>"}`. Generate password hashes offline; never commit credentials.

## Runtime

Environment variables:
- `PHONEBOX_PANEL_ROOT` — exact path of the upstream `android/app/src/main/assets/www` folder.
- `PHONEBOX_WEB_AUTH_FILE` — local ACL-protected hash JSON (NOT in Git).
- `PHONEBOX_VIEW_PORT` — default `8931`.
- `PHONEBOX_ADMIN_PORT` — default `8932`.

Run `node apps/phonebox-web/server.mjs`; both listeners bind exclusively to `127.0.0.1`. `GET /healthz` returns 200 without revealing live data. Only register the two ports with the existing TigerIQ wildcard registrar after verification of source, tests, unique endpoints, ACLs, HTTPS, and rollback.

## Test

`node --test apps/phonebox-web/server.test.mjs`

## Security boundary

The public sites are protected with seven-day, Secure, HttpOnly, SameSite=Strict cookies after password verification. The dashboard allows only named read-only GET APIs. Settings and agent controls are available only through the separately authenticated administration host. Never expose `127.0.0.1:8765` or enable PhoneBox LAN to implement this bridge.

## Acceptance

Check both domains from iPhone Safari: unauthenticated login required, invalid password rejected, successful login, dashboard with real PC01 readings, original settings UI and saving a reversible change, HTTPS certificate, router health, Note8 unaffected, and scheduled-task restart persistence.
