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
