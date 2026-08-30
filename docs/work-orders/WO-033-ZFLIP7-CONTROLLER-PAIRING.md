# WO-033 — Z Flip 7 Controller Pairing

Priority: P0
Status: IMPLEMENTING
Date: 2026-08-31

## Objective
Turn the first real Samsung Z Flip 7 pilot into a registered TigerIQ Workforce node and employee that can maintain a real Controller heartbeat without exposing an admin secret on the phone.

## Physical evidence already received
Owner-provided real-device screenshot confirms the installed TigerIQ Worker pilot reports:
- employee `EMP-001`, department `Research`, role `Researcher`, provider `Gemini`;
- Device identity `READY`;
- Worker runtime `ACTIVE`;
- Accessibility `ON`;
- Controller pairing still `CHƯA GHÉP`.

The screenshot itself is not committed to the repository.

## Design
- PC01/Farm Controller remains the durable authority.
- Pilot Controller target is the private Tailscale address `100.97.23.87:8790`; no public wildcard bind is permitted.
- HTTPS remains mandatory outside the Tailscale CGNAT range. For this pilot, Android cleartext HTTP is scoped to the exact PC01 Tailscale address because Tailscale/WireGuard supplies the encrypted private transport.
- Self-pairing challenge is disabled by default and can only be enabled explicitly on the Controller.
- Self-pairing challenge is served only to peers whose socket source address is within Tailscale `100.64.0.0/10`.
- The device proves possession of its non-exportable Android Keystore P-256 key before receiving a scoped credential.
- The device credential can register only an employee bound to its own authenticated node.
- Worker credentials remain encrypted with Android Keystore AES-GCM.
- After pairing, the foreground Worker sends a bounded heartbeat every 30 seconds and records only concise controller state/error metadata locally.

## User experience
The Worker exposes a single `Ghép Controller` action. It obtains a short-lived challenge, signs it, registers the node, registers the fixed employee, sends the first heartbeat, then reports `PAIRED / ONLINE`. A `Mở Tailscale` action is available for the one-time private-network enrollment.

## Gates
1. Repository CI PASS at exact head.
2. Android Worker build PASS and debug APK artifact produced at exact head.
3. Queue Hygiene PASS.
4. Vercel Verify PASS and existing Web Control preserved.
5. Controller unit/integration tests prove Tailscale address classification, self-pair default-deny, node-scoped employee registration and idempotency.
6. Merge only at the exact tested head.
7. Physical real-device gate after installation: Z Flip 7 shows `Controller pairing: PAIRED`, `Controller: ONLINE`, and a fresh heartbeat.
8. Workforce status must then show one Android node and `EMP-001`; do not claim this gate before live evidence exists.

## Non-claims
- This Work Order does not yet automate prompt submission or result extraction from the Gemini consumer app.
- It does not claim PC01 Controller is currently reachable until live heartbeat evidence exists.
- It does not expose provider credentials, Google credentials, or TigerIQ admin secrets to source control or the Worker app.
