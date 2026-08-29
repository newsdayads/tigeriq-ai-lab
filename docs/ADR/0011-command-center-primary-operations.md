# ADR 0011 — Command Center is the primary operational surface

Status: Accepted by current Owner instruction for WO-010 and subsequent Company OS operations.

## Decision
TigerIQ Command Center becomes the primary surface for task submission, work-order status, PC01 telemetry, review/judge state, evidence links, and Owner reporting.

Trello is removed from the default execution critical path. Normal Work Orders MUST NOT wait for Trello card creation, movement, checklist updates, or reporting synchronization before execution/review/judge can proceed.

## Runtime path
Owner → TigerIQ Command Center → Model Router / PC01 execution → Independent Review → Judge/Gate → Evidence/State → Command Center Owner Report.

## Trello role
Trello is optional only. It may be used for historical archive/manual planning/compatibility when explicitly requested, but failure or absence of Trello synchronization is never a blocker for Work Order execution or completion.

## Rationale
The Command Center already owns the operational control plane and evidence-backed state. Removing mandatory Trello synchronization reduces tool calls, latency, duplicated state, and state-drift risk.

## Safety
Evidence-first, review/judge separation, MAIN/Production gates, security/financial/irreversible authorization requirements, durable state, and privacy boundaries remain unchanged.
