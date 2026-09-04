# Evidence — OpenClaw Control blocker

Date: 2026-09-04
Status: BLOCKED / NOT PASS
Scope: PC01 OpenClaw Control UI access and Gateway connection

## Observed evidence
- `http://127.0.0.1:18789/chat` loads the OpenClaw Control UI in Chrome.
- The UI displays WebSocket target `ws://127.0.0.1:18789`.
- The UI reports that the browser cannot complete the Gateway connection (`Không thể kết nối`).
- Gateway token/password fields are not populated in the shown failed state.
- Multiple attempted helper scripts/dashboard handoffs did not establish a working authenticated Control session.
- The read-only audit attempt produced only its header and therefore did **not** provide reliable process/config/port evidence.

## What is NOT proven
- No proof that the OpenClaw Gateway RPC/transport is healthy.
- No proof that browser pairing/auth is working.
- No proof that token persistence or device credential persistence is working.
- No proof that auto-login is working.
- No proof that reboot recovery for this OpenClaw Control path is working.

## Operational decision
- Stop blind trial-and-error scripts on PC01 for this issue.
- Do not claim OpenClaw Control PASS until Gateway/transport/auth is verified with direct evidence.
- Preserve current system state; avoid repeated restarts, token regeneration, duplicate Gateway launch paths, or interactive owner troubleshooting unless a targeted fix is ready.

## Next safe action
A future engineering session must first obtain reliable direct runtime evidence for the actual Gateway process/config/transport, then apply one targeted reversible fix and retest once.
