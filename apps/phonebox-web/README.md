# TigerIQ PhoneBox Web Gateway

Two **loopback-only** web endpoints on PC01, serving the **installed PhoneBox 0.9.x agent's own HTML, CSS and JavaScript** without changing the Note8 app or its settings.

- \`127.0.0.1:8924\` → \`pc01.tigeriq.io.vn\` (read-only panel; \`/panel/\`).
- \`127.0.0.1:8925\` → \`phonebox.tigeriq.io.vn\` (original settings UI; \`/\`).
- Both require a password; PBKDF2-SHA256 (310k iterations), 7-day signed host-only HttpOnly/Secure cookies, lockout on six failed logins, same-origin write checks.
- View host permits only allowlisted GET API endpoints, blocks command execution and all write methods. Admin host permits only settings writes; it does not expose restart, process kill or arbitrary command execution.
- \`GET /healthz\` is deliberately public for the existing PC01 registrar's origin/HTTPS checks; it contains no machine data.
- The local PhoneBox agent continues to bind only \`127.0.0.1:8765\`. Do not enable LAN access or expose its raw port.

Run \`node --test apps/phonebox-web/server.test.mjs\`. Deploy **only a CI-verified main commit** to PC01 via the existing PC01-only release process and one-writer router registrar. Start \`node server.mjs\` as the current Windows user with \`PB_AUTH_FILE\` pointing to an ACL-restricted JSON file containing \`salt\`, \`hash\`, and \`sessionSecret\` (all hex; never commit secrets). Password hash: PBKDF2-HMAC-SHA256, 310000 iterations, 32 bytes, random 16+ byte salt. Session secret: random 32+ bytes.

Public access is through the existing Cloudflare wildcard Tunnel and router; register each distinct port with \`register-public-webapp.ps1 -Name pc01 -Port 8924 -HealthPath /healthz -Public\` and similarly \`-Name phonebox -Port 8925\`. No DNS edits and no additional Tunnel.

The upstream PhoneBox project is by ersinkoc: https://github.com/ersinkoc/phonebox (MIT). The gateway proxies its installed assets rather than redistributing a modified PhoneBox binary. Browser Safari acceptance and Note8 regression must be verified independently.
