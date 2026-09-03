# ADR 0011 — Command Center is the primary operational surface

Status: Accepted by current Owner instruction for WO-010 and subsequent Company OS operations. Updated 2026-09-03 by WO-059.

## Decision
TigerIQ Command Center is the primary surface for task submission, work-order status, PC01 telemetry, review/judge state, evidence links, and Owner reporting.

As of 2026-09-03 the hosting/runtime precedence is explicit:
1. **PRIMARY Web Control: PC01 Command Center**, running from the existing `apps/dashboard` implementation on PC01 and exposed only through localhost or an explicit approved private/Tailscale address.
2. **SECONDARY/BACKUP: Vercel**, retained as a fallback surface only. Vercel Git deployment remains disabled while the known quota blocker exists; no retry loop or paid upgrade is part of this decision.

This architecture decision does not itself prove that the PC01 runtime deployment has passed physical tests. Physical URL, startup recovery, remote Tailscale access and Web→PC01 execution must still be evidenced before the corresponding Work Order can be DONE.

Trello is removed from the default execution critical path. Normal Work Orders MUST NOT wait for Trello card creation, movement, checklist updates, or reporting synchronization before execution/review/judge can proceed.

## Runtime path
Owner → PC01 TigerIQ Command Center → Model Router / PC01 execution → Independent Review → Judge/Gate → Evidence/State → Command Center Owner Report.

Vercel is not in the normal execution critical path.

## Data rule
Command Center reads evidence-backed Work Order state and PC01 runtime telemetry directly. Missing telemetry/provider/workforce data MUST render as unavailable/chưa có dữ liệu and MUST NOT be mocked or inferred.

## Network boundary
- No router port-forwarding/public Internet exposure.
- No `0.0.0.0` or `::` listener.
- Remote Owner access is through an explicit Tailscale/private address with host firewall scope restricted to the tailnet.
- Existing auth, CSRF, idempotency, security headers and secret-redaction boundaries remain mandatory.

## Trello role
Trello is optional only. It may be used for historical archive/manual planning/compatibility when explicitly requested, but failure or absence of Trello synchronization is never a blocker for Work Order execution or completion.

## Performance rule
Default execution must avoid redundant status replication. Command Center reads from the evidence-backed control plane and PC01 telemetry directly; no Trello write is required for milestone progression or DONE/REAL BLOCKER/EXTERNAL WAIT determination.

## Rationale
PC01 already provides the local compute/control-plane foundation and keeps operational telemetry, execution and evidence close to the actual runtime. Making it primary avoids dependence on Vercel availability/quota for daily operation while retaining Vercel as a reversible backup.

## Safety
Evidence-first, review/judge separation, MAIN/Production gates, security/financial/irreversible authorization requirements, durable state, and privacy boundaries remain unchanged.
