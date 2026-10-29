# TigerIQ — RDC Remote Pool Policy

Status: CURRENT
Updated: 2026-10-05
Scope: Remote Desktop Commander (RDC) multi-account pool on PC01

## PC01 CHANNEL ORDER — OWNER 2026-10-30
- PC01 device actions: **authenticated TigerIQ PC01 OAuth MCP first** (read-only capability/health check, then action with real receipt), **RDC pool second** only if MCP is unavailable or lacks the capability and the exact RDC action is independently authorized.
- Do not use RDC or another connector to circumvent MCP authentication, scope, UAC, security denial, one-writer lease, production gate or a host tool rejection. Do not retry an uncertain mutation across channels before checking its receipt.
- GitHub/Google Drive actions use their native connectors rather than PC01 transport. Every new session must verify which MCP tools and RDC account links are actually exposed.
- Keep all HARD ROUTING, quota selection, account tie-breaking, failover and audit rules below unchanged.

## HARD ROUTING — P0 OWNER OVERRIDE 2026-10-15
- Applies to every **already-authorized** ChatGPT-to-RDC operation within TigerIQ, not only the `RDC CHECK` shortcut. It does not authorize a new device action by itself.
- Before starting each independent RDC operation, inspect the currently exposed linked accounts via `who_am_i` and `list_devices` (account metadata reads only). Use fresh actual connector readings; never pin one account or rely on an earlier quota snapshot.
- Eligible = connector link exposed in this chat, authenticated, PC01 Online on that account's device ID, and numeric `remote_calls_left_pct > 0`. Unknown/offline/0% accounts are excluded, not assumed healthy.
- Sort eligible links by **descending remaining percentage**, then by ascending stable `RDC01..RDC05` account number. Use that account's own `link_id` and `deviceId` for the actual RDC call. Recalculate when a new operation begins, or the selected link becomes unavailable.
- On quota exhaustion or a known *pre-execution* failure, try the next eligible account in that fresh ordering if provider/platform policy allows. Never rotate linked identities to bypass a security, authentication, permissions or anti-abuse denial.
- For read-only calls, failover is permitted. For writes with an uncertain execution outcome, first inspect the resource and completion receipt through an authorized read-only path; do not blindly replay the write on another account. Preserve one writer per resource.
- If no eligible account remains, report `RDC_POOL_UNAVAILABLE` with actual exclusion reasons. Do not reconnect accounts automatically, invent capacity, or convert local PC01 availability into a ChatGPT connection.
- This is a **canonical routing requirement for participating TigerIQ chats/agents**, not proof that the native ChatGPT connector implements a persistent host-level automatic router. Global/cross-chat acceptance requires actual host connector configuration and new-session tests. Do not claim it is installed solely from this GitHub policy.
- Do not perform background polling or charge device-bound calls just to monitor quota. Use this rule only when an actual authorized RDC operation is requested.

## ENFORCEMENT — 2026-10-17 (TIGERIQ-owned connector callers)
- Executable guard: `apps/shared/rdc-account-preflight.mjs` exporting `inspectRdcPool` and `executeRdcWithPool`. Regression: `tests/rdc-account-preflight.test.mjs`.
- Every owned app/agent that directly invokes RDC MUST bind actual exposed `link_id` values to stable `RDC01..RDC05`, and pass the real `who_am_i`, `list_devices` and tool-invoker functions into `executeRdcWithPool`. Its returned selected `link_id` and paired PC01 `deviceId` are mandatory arguments to the RDC device call.
- Fail closed before executing anything when operation is not explicitly authorized, quota/device status is unknown, PC01 offline, or all links have 0%. Do not select a hard-coded default account. Eligibility rechecked for every independent operation; only explicit pre-execution/quota failures permit failover. An ambiguous write MUST NOT be repeated.
- Merely adding this module to the repository is NOT runtime integration. Acceptance needs callsite binding, exact-head checks, actual PC01 read-only call on a non-primary account, readback after release, and tests in fresh ChatGPT sessions. The ChatGPT native plugin host cannot be forcibly patched from this GitHub repository; host-level routing remains UNVERIFIED unless independently configured and tested.

## Runtime architecture
- PC01 uses five independent Desktop Commander Remote sessions: `RDC01` → `RDC05`.
- Each session has its own persisted profile under `D:\TigerIQ\RDCProfiles\RDC0N`.
- Each session is started by its own Windows Scheduled Task: `TigerIQ RDC01 Remote` → `TigerIQ RDC05 Remote`.
- Tasks run pinned Desktop Commander `0.2.52` directly; do not use `npx @latest` at boot.
- Legacy pooled supervisor tasks `TigerIQ Desktop Commander Remote` and `TigerIQ Desktop Commander Watchdog` are disabled.
- Normal reboot must not require reconnect/login again. Reconnect is only required when the device is revoked/logged out or the persisted session is invalid.

## Chat shortcut — RDC CHECK
When anh Sơn sends exactly or clearly means `RDC CHECK`:
1. Inspect every RDC plugin link exposed to the current ChatGPT session.
2. For each account, call account metadata/usage and device status using the RDC connector.
3. Report compactly with icons:
   - ✅ account/email — PC01 Online — <N>% còn lại
   - ⚠️ account/email — PC01 Offline — <N>% còn lại
4. Select the preferred execution link from accounts where PC01 is Online and `remote_calls_left_pct > 0`; prefer the highest remaining percentage.
5. A tie may use a deterministic available account; never use a 0% account while another eligible account exists.
6. The check is read-only. Do not reconnect, revoke, log out, mutate PC01, or consume a device-bound tool call merely to inspect quota.
7. If a configured link is not exposed in the current chat/plugin context, report `MISSING_LINK`; do not invent or reconnect it.

## Chat shortcut — RDC CHECK FULL
`RDC CHECK FULL` performs the same audit and additionally reports:
- device count,
- PC01 Online/Offline,
- device app version and last-seen when exposed,
- preferred execution account,
- excluded accounts and reason (0%, offline, missing link).

## Quota truth
- The ChatGPT RDC connector currently exposes `remote_calls_left_pct` (remaining percentage).
- Do not infer an exact raw call count from the rounded percentage.
- If anh Sơn needs the absolute count shown by Desktop Commander UI (for example `112 of 10,000`), direct UI/Usage is the authority unless a future connector field exposes that raw count.

## Pool failover
- Before an RDC operation, prefer an exposed link with PC01 Online and remaining quota > 0.
- Mutating one resource uses one selected RDC link as the writer.
- If that link fails before mutation starts, fail over to another eligible link.
- If failure occurs after mutation may have started, verify resulting state before failover; never blindly duplicate the mutation.
- Read-only operations may fail over freely.
