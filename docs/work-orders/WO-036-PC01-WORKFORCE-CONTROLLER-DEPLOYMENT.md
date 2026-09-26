# WO-036 — PC01 Workforce Controller deployment package

## Goal
Prepare a single-action, fail-closed Windows deployment package that can turn PC01 into the durable private Workforce Controller for physical Android employees without requiring the Owner to manually assemble commands.

## Scope
- install/preflight PowerShell scripts only; no unattended claim that PC01 was actually changed;
- controller discovers the **live** PC01 Tailscale IPv4 with `tailscale ip -4`, requires exactly one address in `100.64.0.0/10`, verifies Windows owns it, and binds only to that explicit address on port `8790`; no historical IP is trusted blindly;
- tailnet self-pairing is explicitly enabled for the Android Worker while the Controller still verifies the connecting peer is sourced from `100.64.0.0/10`;
- durable journal remains under `F:\TigerIQ\State\workforce.jsonl` by default;
- runtime admin secret is generated locally and stored outside the repository with restricted ACL; it is never printed or committed and is not required by the phone self-pair flow;
- Windows Scheduled Task runs at startup under SYSTEM so the Controller does not depend on an interactive user logon;
- Windows Firewall rule is limited to the resolved local Controller address/port and Tailscale CGNAT range;
- install script performs repo/build/node/Tailscale/IP/port preflight and fails closed on ambiguity or mismatch;
- audit script independently resolves the live Tailscale address and reports task, HTTP status, explicit listener, wildcard-listener absence, self-pair configuration and journal presence without exposing secrets;
- uninstall/rollback removes only WO-036-created Scheduled Task/firewall/runtime wrapper; it does not delete Workforce state or credentials.

## Acceptance gates
1. scripts parse under PowerShell syntax checks;
2. deterministic static tests verify live Tailscale discovery, no historical-IP assumption, no wildcard bind, self-pair enablement, no plaintext secret in repo/output, startup SYSTEM task intent, restricted firewall scope and non-destructive rollback;
3. repository CI + Queue Hygiene + Vercel Verify PASS at exact PR head;
4. merge does **not** imply PC01 deployment PASS;
5. physical deployment remains `READY_FOR_PC01_TEST` until PC01 evidence shows explicit private listener + Controller HTTP 200 and the physical Z Flip 7 heartbeat.

## Next physical gate
One bundled PC01 deployment action. The installer reports the actual resolved Controller address. Then install/update a stable-signed TigerIQ Worker build on the Z Flip 7, use that Controller address if it differs from the pilot default, and press **Ghép Controller**. Only live node heartbeat evidence may mark `EMP-001 ONLINE`.
