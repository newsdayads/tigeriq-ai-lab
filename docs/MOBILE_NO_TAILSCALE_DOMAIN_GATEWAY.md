# TIGERIQ — Mobile App Connectivity: No Tailscale on Phones

OWNER_DIRECT=2026-11-22 | SCOPE=ALL_TIGERIQ_PROJECTS | PRIORITY=P0
STATUS=OWNER_APPROVED_POLICY
SOURCE=Owner instruction in PhoneBox conversation (2026-11-22)

## Mandatory rule
- DO NOT require, install, bundle, recommend, or prompt users to install Tailscale or another device-level VPN/tailnet client on an end-user phone (including Samsung Z Flip) as a prerequisite to use any TigerIQ mobile app.
- Mobile users must access online services through an HTTPS domain / controlled intermediary gateway (for example `*.tigeriq.io.vn` via PC01 and Cloudflare Tunnel), with the appropriate app/API protocol, authentication and device security.
- Preserve Android app native UI where feasible; the mobile app connects to the authenticated domain gateway rather than depending on a local network or Tailscale installed on the phone.
- A VPN-less phone does NOT justify exposing unauthenticated PC01 APIs, raw PhoneBox agent ports, session secrets, unrestricted commands, or pairing credentials to the public Internet. Design a constrained gateway with proper identity/pairing, allowlisted read-only endpoints for monitoring, rate limiting, audit logs, TLS, and explicit authorization for control commands.
- PC01/server-side private networking, including Tailscale where already deployed, can remain if necessary. This prohibition concerns installation/configuration on end-user phones.
- For PhoneBox: investigate compatibility between the official Android application’s native pairing/transport requirements and a secure HTTPS intermediary. Do not assert that the upstream app supports arbitrary HTTPS gateway URLs without a validated device test. If it cannot, propose a reviewed app-side transport adapter or secure branded Android wrapper that uses the official web UI and restricted gateway.
- This is an Owner product/security distribution policy. The owner described phone-side Tailscale as likely to make an app be treated as malware; do not present that claim as a proven Android security-detection fact.
- Never replace a verified owner-approved domain route with phone-side VPN as a workaround.

## Acceptance
1. No Tailscale (nor other VPN client) installed or requested on any end-user phone.
2. Remote mobile access works over Wi-Fi and cellular via HTTPS domain with tested authentication.
3. Existing PC01 security fences and owner Google access remain intact.
4. Each Android APK/native application requires real install/online connection/permission and security testing before claiming DONE.

CANONICAL_ENTRYPOINT=bootstrap/00_TIGERIQ_LOADER.md
