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

## Temporary no-login public view (Owner direct request 2026-11-22)

`PB_PUBLIC_READONLY=1` is the default for this PC01-hosted build. Both sites open directly without the PhoneBox Web password:

- `pc01.tigeriq.io.vn/` displays the original PhoneBox **panel assets** with only a deliberately sanitized, read-only PC telemetry snapshot (CPU/GPU/RAM/network). Only safe Home/System widgets are provided; no work sessions, private processes, personal notes, media, tokens or private configuration data are exposed.
- `phonebox.tigeriq.io.vn/` displays a separate **read-only settings summary and panel preview**, NOT the live write-enabled PhoneBox agent settings UI. It does not expose the agent's internal settings API.
- Both hostnames reject all POST/PUT/PATCH/DELETE (HTTP 405), and every private API GET is denied (HTTP 404). The dashboard's only dynamic public GET routes are sanitized `/agent/api/config` and `/agent/api/state`. The real PhoneBox agent stays exclusively on PC01 loopback.
- The legacy password mode is retained for a future secured release by explicitly setting `PB_PUBLIC_READONLY=0` on the PC01 task, after owner approval and safeguards. No raw admin settings interface is ever opened publicly without authentication.

Run `node --test apps/phonebox-web/server.test.mjs apps/phonebox-web/server.integration.test.mjs apps/phonebox-web/server.public.test.mjs` before releasing. This approach temporarily defers online editing rather than allowing anyone on the Internet to change PC01 or Note8 settings.
