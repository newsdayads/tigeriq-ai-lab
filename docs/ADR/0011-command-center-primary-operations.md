# ADR 0011 — Command Center is the primary operational surface

Status: Accepted by current Owner instruction for WO-010 and subsequent Company OS operations.

## Decision
TigerIQ Command Center becomes the primary surface for task submission, work-order status, PC01 telemetry, review/judge state, evidence links, and Owner reporting.

Trello is excluded from **all TigerIQ AI Lab project operations**, not just the default critical path. No TigerIQ Work Order may create, query, assign, update, synchronize, report from, or depend on Trello. GitHub Issues / TigerIQ Work Orders and Command Center are the project work-management surfaces. This 2026-10-22 reaffirmation implements the Owner's original 2026-09-03 removal (historical evidence: Issue #169).

## Runtime path
Owner → TigerIQ Command Center → Model Router / PC01 execution → Independent Review → Judge/Gate → Evidence/State → Command Center Owner Report.

## Trello exclusion
Trello is **not an optional project backend**, integration, archive destination, manual planning lane, or task source for TigerIQ. Do not reactivate obsolete adapters or recommend Trello inside this project. Historical ADRs/issues may retain Trello references as immutable audit context; these do not authorize its use. This decision does **not** delete personal Trello records or change access to unrelated projects.

## Performance rule
Default execution must avoid redundant status replication. Command Center reads from the evidence-backed control plane and PC01 telemetry directly; no Trello write is required for milestone progression or DONE/REAL BLOCKER/EXTERNAL WAIT determination.

## Rationale
The Command Center already owns the operational control plane and evidence-backed state. Removing Trello entirely from the TigerIQ workflow reduces tool calls, latency, duplicated state, and state-drift risk.

## Safety
Evidence-first, review/judge separation, MAIN/Production gates, security/financial/irreversible authorization requirements, durable state, and privacy boundaries remain unchanged.
