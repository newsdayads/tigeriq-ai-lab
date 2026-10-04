# TigerIQ — RDC Remote Pool Policy

Status: CURRENT
Updated: 2026-10-05
Scope: Remote Desktop Commander (RDC) multi-account pool on PC01

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
