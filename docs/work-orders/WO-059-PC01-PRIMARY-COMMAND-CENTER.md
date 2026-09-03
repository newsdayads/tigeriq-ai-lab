# WO-059 — PC01 Primary Command Center

Date: 2026-09-03
Priority: P1
Status: REAL_BLOCKER
Canonical ingress: GitHub Issue #194

## Goal
Run the existing TigerIQ Command Center from `apps/dashboard` directly on PC01 as the PRIMARY private Web Control surface. Vercel remains SECONDARY/BACKUP with Git deployments disabled while quota is blocked.

## Required architecture
- PRIMARY: PC01 Command Center.
- SECONDARY/BACKUP: Vercel.
- Private access: explicit PC01 Tailscale IPv4 only for remote devices; localhost is allowed for local-only use.
- Forbidden: `0.0.0.0`, `::`, public Internet/router exposure.
- Existing auth, CSRF, idempotency and security headers remain fail-closed.
- No OpenClaw.

## Data policy
The Command Center may display only observed state/evidence. It reads Work Orders and Evidence/Gates from the durable local control-plane journal and PC01 runtime telemetry from local OS/runtime probes. Missing data is rendered as `Chưa có dữ liệu`/`Unavailable` rather than inferred.

Telemetry scope:
- CPU/RAM/disk/uptime;
- GPU via `nvidia-smi` when present;
- Ollama via localhost API;
- Tailscale IPv4;
- Native GitHub queue worker process;
- Workforce Controller health;
- PostgreSQL service/listener health.

## Implementation branch
`wo-059-pc01-primary-command-center`

Changes prepared:
1. `apps/dashboard/src/server.ts`
   - Vy identity and `Giao việc cho Vy`;
   - real Controller/PostgreSQL telemetry projection;
   - real AI Workforce projection from observed PC01 runtime only;
   - fail-closed public-address validation;
   - preserves auth/CSRF/idempotency/security headers and responsive layout.
2. `scripts/pc-worker/pc01-telemetry.ps1`
   - adds Native Worker, Controller and PostgreSQL probes;
   - keeps Ollama/Tailscale/GPU/host telemetry;
   - does not read or emit credentials.
3. `scripts/pc-worker/install-command-center.ps1`
   - default deployment source corrected from stale WO-010 branch to `main`;
   - validates Tailscale CGNAT address;
   - tailnet-only Windows Firewall rule;
   - Scheduled Task at Windows startup as SYSTEM with restart policy;
   - health and wildcard-exposure fail-closed checks.
4. Tests cover responsive identity/security/runtime projections and Vercel deployment policy.

## Required physical tests A–K
A. Local PC01 Command Center open.
B. Desktop layout.
C. Mobile/responsive layout.
D. Tailscale remote-device access.
E. Real telemetry/unavailable behavior.
F. Real Work Order list/status.
G. Web -> PC01 queue -> execute -> result/evidence.
H. Restart/autostart recovery.
I. No public exposure.
J. Vercel deployment disabled.
K. Vy identity regression.

## Current blocker
Issue #194 was received by PC01 but PC01 returned `TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW`: Secure V3 requires three distinct immutable local Ollama model digests for AI jobs. The current chat runtime has no authenticated direct PC01 shell/service-control channel that can install/start the Command Center independently of that gated queue.

The security gate MUST NOT be weakened or bypassed merely to complete this Work Order.

## Next action
On PC01, satisfy the existing Secure V3 independent-model gate or provide the already-authorized authenticated local operations execution path. Then execute this branch installer for physical verification, run A–K, record private URL/task/test evidence, and only then move this Work Order to DONE.
