# TigerIQ PhoneBox Web Gateway

Two **loopback-only** web endpoints on PC01, serving the **installed PhoneBox 0.9.x agent's own HTML, CSS and JavaScript** without changing the Note8 app or its settings.

- \`127.0.0.1:8924\` → \`pc01.tigeriq.io.vn\` (read-only panel; \`/panel/\`).
- \`127.0.0.1:8925\` → \`phonebox.tigeriq.io.vn\` (original settings UI; \`/\`).
- Both require a dedicated **PhoneBox Web** username `Administrator` plus password (unrelated to Windows Administrator); PBKDF2-SHA256 (310k iterations), 7-day signed host-only HttpOnly/Secure cookies, lockout on six failed logins, same-origin write checks.
- View host permits only allowlisted GET API endpoints, blocks command execution and all write methods. Admin host permits only settings writes; it does not expose restart, process kill or arbitrary command execution.
- \`GET /healthz\` is deliberately public for the existing PC01 registrar's origin/HTTPS checks; it contains no machine data.
- The local PhoneBox agent continues to bind only \`127.0.0.1:8765\`. Do not enable LAN access or expose its raw port.

Run \`node --test apps/phonebox-web/server.test.mjs\`. Deploy **only a CI-verified main commit** to PC01 via the existing PC01-only release process and one-writer router registrar. Start \`node server.mjs\` as the current Windows user with \`PB_AUTH_FILE\` pointing to an ACL-restricted JSON file containing \`salt\`, \`hash\`, and \`sessionSecret\` (all hex; never commit secrets). Password hash: PBKDF2-HMAC-SHA256, 310000 iterations, 32 bytes, random 16+ byte salt. Session secret: random 32+ bytes.

Public access is through the existing Cloudflare wildcard Tunnel and router; register each distinct port with \`register-public-webapp.ps1 -Name pc01 -Port 8924 -HealthPath /healthz -Public\` and similarly \`-Name phonebox -Port 8925\`. No DNS edits and no additional Tunnel.

The upstream PhoneBox project is by ersinkoc: https://github.com/ersinkoc/phonebox (MIT). The gateway proxies its installed assets rather than redistributing a modified PhoneBox binary. Browser Safari acceptance and Note8 regression must be verified independently.

## Setting or changing the PhoneBox Web password

The password is **not** stored in this repository and is not the Windows account password. From an interactive PowerShell session on PC01 under the scheduled-task user's Windows profile, run `powershell -NoProfile -File D:\TigerIQ\Apps\PhoneBoxWeb\set-local-password.ps1`, enter the desired password twice when prompted (hidden), then restart only the scheduled task `TigerIQ PhoneBox Web`. The script rotates the session key, writes a new salted hash atomically, and maintains ACLs. Never print or pass this password in a command-line argument, GitHub issue, or log. The host-side operator must not circumvent a connector's credential-write security denial.

## Owner-approved login-free public widget editor (2026-11-22)

With `PB_PUBLIC_READONLY=1` and `PB_PUBLIC_WIDGET_EDIT=1` (both default), the original upstream PhoneBox Settings UI opens without a login:

- `pc01.tigeriq.io.vn`: public **read-only** dashboard; no writes or private machine data.
- `phonebox.tigeriq.io.vn`: original PhoneBox Settings UI, with **Save** restored. Only changes to page/widget layout, allowed widget display options and safe visual widgets are merged into the current agent configuration. Other configuration fields and secrets are always preserved from the private live agent. Stale writes return HTTP 409.
- All other GET APIs are denylisted/allowlisted as before; POST/DELETE and any PUT except `/api/settings` remain HTTP 405; editing raw controls, webhook keys, commands, rules, shortcuts, LAN, PC power, agent restart, and other PC administrative settings is not available on the public host. This is **not** full unauthenticated local administrator access.
- **Security warning:** With no login, anyone who can reach the public editor URL can rearrange, add, or delete allowed widgets. Rate limiting and Origin checks reduce accidents and browser-origin abuse but **do not authenticate the owner**. This is an owner-requested risk accepted at the website layer. Recommended future hardening is private VPN/IP allowlisting or Cloudflare Access. Set `PB_PUBLIC_WIDGET_EDIT=0` to immediately revert public Settings to read-only without changing the dashboard.
- The installed PhoneBox agent remains private at `127.0.0.1:8765`, and original Note8 connectivity is unaffected.

Run `node --test apps/phonebox-web/server.test.mjs apps/phonebox-web/server.integration.test.mjs apps/phonebox-web/server.public.test.mjs apps/phonebox-web/server.widget-edit.test.mjs`. Apply only after exact-head checks, merge/readback, SHA-verified PC01 release, and both-site HTTPS acceptance. The real iPhone browser must be verified separately.


- For an authorized widget save, the gateway reads the complete current settings **only from local PC01 loopback** using the upstream desktop fetch-metadata contract; it never writes the `/api/config` phone/public snapshot, which intentionally omits private shortcuts and tokens. Only sanitized editor fields are accepted from the browser; the private snapshot is never returned to the Internet.


## Private full original PhoneBox UI (Owner request 2026-11-22)

The owner wants exactly the installed PhoneBox Settings at `127.0.0.1:8765`, all widgets and control APIs, with **no separate PhoneBox web login**. PhoneBox upstream's own host/origin anti-forgery gate deliberately returns HTTP 403 when a public hostname is forwarded raw.

A third PC01 **loopback-only** listener runs as part of the existing PhoneBox Web task:
- `127.0.0.1:8936` (production only; `PB_PRIVATE_TAILNET_PORT` can override). This proxies the **original full upstream UI and its actual APIs** to `127.0.0.1:8765`, rebuilding the upstream loopback Host/Origin after confirming the browser used the exact tailnet origin.
- Tailscale Serve (NOT Funnel) terminates private HTTPS for `https://pc01.tail35d2f3.ts.net:8767/` and forwards to `http://127.0.0.1:8936`. Other pre-existing Tailscale Serve/Funnel ports are preserved.
- This third listener must **NEVER** be registered with Cloudflare's public wildcard router, port-forwarded on the firewall, or exposed via Tailscale Funnel. Tailscale network device enrollment and tailnet ACLs form the access boundary. There is **no PhoneBox login page** on this private site.
- `phonebox.tigeriq.io.vn` remains the publicly reachable **scoped widget editor**, and `pc01.tigeriq.io.vn` remains the read-only public monitor. Neither public hostname exposes raw PC controls or secrets. Do not replace a public route with the private listener.
- IMPORTANT: tailnet ACLs must restrict which devices can access the PC01 service. Existing tailnet peers should not automatically be assumed to be trusted for arbitrary PC controls.
- The physical owner's iPhone must have Tailscale installed and connected to the PC01 tailnet to use the private URL. iPhone acceptance is NOT asserted until tested.

Run `node --test apps/phonebox-web/server.test.mjs apps/phonebox-web/server.integration.test.mjs apps/phonebox-web/server.public.test.mjs apps/phonebox-web/server.widget-edit.test.mjs apps/phonebox-web/server.private-tailnet.test.mjs`. Release only via GitHub main exact-source and protected CI. Verify original Settings GET 200, full /api/settings only inside tailnet, website JavaScript, and that public routes still deny system controls.


## Owner Google Sign-In → Full original PhoneBox on one public subdomain

The original PhoneBox agent stays private at `127.0.0.1:8765`. The existing public wildcard route `phonebox.tigeriq.io.vn → PC01 router → 127.0.0.1:8925` stays unchanged. After **verified** Google Owner sign-in, the current PhoneBox Web gateway proxies the complete original Settings UI/assets and native APIs, without any widget/command allowlist. PC01 monitoring at `pc01.tigeriq.io.vn` remains GET-only.

- Google identity: **only** `newsdayads@gmail.com`, with verified email and audience matching the OAuth client. The server verifies Google-signed RS256 ID tokens with public Google JWKs, requires an HMAC-signed short-lived nonce, and issues a separate Secure/HttpOnly/SameSite=Strict Owner session cookie. No secret or tokens are returned to the public browser.
- Use the existing Google Cloud project `tigeriq-driver`, OAuth Web client `832918518381-sveiabkajbo6vbi45v86tqtolc6j8m2n.apps.googleusercontent.com` (public client ID). **Before enabling production**, add `https://phonebox.tigeriq.io.vn` to **Authorized JavaScript origins**. Do not remove existing origins: `https://driver.tigeriq.io.vn` and `https://pc01.tail35d2f3.ts.net:8443`.
- Google Identity Services needs **no new client secret**, no Cloudflare Access enrollment, no Tailscale on owner iPhone, no new DNS, no new Tunnel, and no Vercel deploy.
- Activation after the Google OAuth Web client origin is accepted: create the private local file `D:\\TigerIQ\\State\\PhoneBox\\google-owner.enabled` on PC01 and restart the existing `TigerIQ PhoneBox Web` scheduled task. This avoids changing the scheduled task's arguments or requiring administrator elevation. `PB_GOOGLE_AUTH=1` is also supported; `PB_GOOGLE_AUTH=0` disables the file-based mode. Check browser Google auth end-to-end before claiming production done. If explicitly enabled but identity is unconfigured, admin returns **503** and denies operations; it NEVER falls back to anonymous full access.
- Do **not** enable Google mode before Google Cloud authorized origin has been confirmed and rollout/rollback checkpoint is available. Anonymous public widget edits remain as before until then.
- Regression: `node --test apps/phonebox-web/server.test.mjs apps/phonebox-web/server.integration.test.mjs apps/phonebox-web/server.public.test.mjs apps/phonebox-web/server.widget-edit.test.mjs apps/phonebox-web/server.private-tailnet.test.mjs apps/phonebox-web/server.google-owner.test.mjs`. Verify stale password sessions do not confer Google Owner access.


## PC01 monitor Google Owner login (2026-11-22)

The existing Google Cloud OAuth Web client already has `https://pc01.tigeriq.io.vn` and `https://phonebox.tigeriq.io.vn` in its Authorized JavaScript origins, without removing previous origins. With the existing PC01 private `google-owner.enabled` flag enabled, both sites use the **same Google verified Owner identity** but separate, host-only, role-bound session cookies.

- `phonebox.tigeriq.io.vn`: full original native PhoneBox after login; contains native control APIs.
- `pc01.tigeriq.io.vn`: login required for **monitoring only**; data stays sanitized and all POST/PUT/DELETE commands remain blocked, including owner sessions.
- Login uses the same public Google Web Client ID and RS256 verified identity `newsdayads@gmail.com`; no Google client secret, Cloudflare Access, Tailscale, DNS or new HTTP service. Default system command restrictions remain unchanged for PC01 monitoring.
- Production activation flag is ignored by isolated test listeners using nondefault ports; explicitly configured PB_GOOGLE_AUTH or PB_GOOGLE_ENABLE_FILE still support tests.

Acceptance: verify unauthenticated GET redirect to `/__auth/google` for both sites; HTTP 200 Google button, separate cookies, authenticated PC01 panel GET 200 and PC01 command POST HTTP 405; PhoneBox still permits original controls only after Google Owner login. Do not infer real Owner Google sign-in acceptance from a mock JWK test.


## Reuse PC01 Google Owner login for full PhoneBox (2026-11-22)

An already-verified `newsdayads@gmail.com` Google Owner session at `pc01.tigeriq.io.vn` can sign into the full original `phonebox.tigeriq.io.vn` without a second Google account popup. The existing PC01 gateway issues a signed, audience-restricted, **single-use 45-second ticket** from the view-side authenticated session. The PhoneBox-side ticket redemption sets the full Owner cookie and redirects to `/#pages`. Failed/replayed/anonymous tickets are rejected. No new Google Cloud, Cloudflare, Tailscale, DNS, Tunnel, database or app is required.

- PhoneBox root redirects through `/__auth/sso` to the PC01-issued one-time ticket. If PC01 has no valid Owner session, it redirects to the existing PhoneBox Google login instead.
- PhoneBox Google login includes a link to continue with an existing authenticated PC01 session.
- PC01 remains strictly **read-only**, including during ticket issuance; it never exposes system command APIs or PC secrets.
- No account/password/token bypass: both sessions require an HMAC-signed cookie originating from an already verified Google Owner ID token. Ticket grants are replay-protected and expire in 45 seconds.
- Source tests: `server.owner-sso.test.mjs` plus existing test suite. Real Owner-browser SSO is verified separately after release.



## PC01 — exact PhoneBox Live Preview as the monitoring page

Owner request (2026-11-22): `pc01.tigeriq.io.vn` should display **only** the original PhoneBox panel already used by the `Xem trước trực tiếp` button in Settings; **no new monitor UI** and no manually recreated widget list.

- Existing authenticated Google Owner PC01 root continues to redirect to `/panel/`, which serves the **original upstream** PhoneBox `/panel/` HTML/CSS/JS. This is the exact same original panel component used by Settings' preview iframe `../panel/?preview=1`; the standalone panel without `preview=1` displays the **saved layout** automatically, so no cross-domain unsaved settings need to be copied.
- The logged-in PC01 monitoring host now forwards original GET `/agent/api/config`, `/agent/api/state` and `/agent/api/stream` to PC01-local PhoneBox; this preserves **all original saved pages and widget types** plus live values instead of the earlier sanitized two-page home/system reconstruction. Other asset and data requests retain the strict existing view allowlist.
- **Read-only remains enforced** for all PC01 POST/PUT/DELETE and administrative control APIs, even for Google Owner; full PC controls live only at `phonebox.tigeriq.io.vn` after Owner sign-in.
- No new page design, separate service, new DNS, Tunnel, Cloudflare Access or additional authentication. No changes to PhoneBox agent, Android/Note8 or saved widgets.
- Unsaved changes visible only within PhoneBox Settings' embedded preview require pressing **Lưu** to appear on the standalone PC01 monitor. No new rendering is invented.
- Regression test checks that a third page and its media widget remain available to PC01 Owner, not filtered down to two pages. Real Chrome/mobile acceptance should verify layout and live data.
