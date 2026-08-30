# WO-036 — PC01 Workforce Controller deployment package

## Goal
Prepare a single-action, fail-closed Windows deployment package that can turn PC01 into the durable private Workforce Controller for physical Android employees without requiring the Owner to manually assemble commands.

## Scope
- install/preflight PowerShell scripts only; no unattended claim that PC01 was actually changed;
- controller binds only to the configured PC01 private/Tailscale address (default `100.97.23.87`) on port `8790`;
- durable journal remains under `F:\TigerIQ\State\workforce.jsonl` by default;
- runtime admin secret is generated locally and stored outside the repository with restricted ACL; it is never printed or committed;
- Windows Scheduled Task runs at startup under SYSTEM so the Controller does not depend on an interactive user logon;
- Windows Firewall rule is limited to the Controller port/local address and Tailscale CGNAT range;
- install script performs repo/build/node/Tailscale/IP/port preflight and fails closed on mismatch;
- audit script reports controller process/task, HTTP status, bind target and journal presence without exposing secrets;
- uninstall/rollback removes only WO-036-created Scheduled Task/firewall/runtime wrapper; it does not delete Workforce state or credentials.

## Acceptance gates
1. scripts parse under PowerShell syntax checks;
2. deterministic static tests verify no wildcard bind, no plaintext secret in repo/output, startup SYSTEM task intent, restricted firewall scope and non-destructive rollback;
3. repository CI + Queue Hygiene + Vercel Verify PASS at exact PR head;
4. merge does **not** imply PC01 deployment PASS;
5. physical deployment remains `READY_FOR_PC01_TEST` until PC01 evidence shows Controller HTTP status and the physical Z Flip 7 heartbeat.

## Next physical gate
One bundled PC01 deployment action, then update/install TigerIQ Worker pairing APK on Z Flip 7 and press **Ghép Controller**. Only live node heartbeat evidence may mark `EMP-001 ONLINE`.
