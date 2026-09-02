# TIGERIQ — EXTERNAL WORKBOARD BOUNDARY V1

Status: GOVERNANCE CONTRACT · OFF MAIN/PRODUCTION  
Owner decision: 2026-09-03  
Applies to: CHAT00 / NV00, all AI Employees, Owner Cockpit projections, external task/workboard integrations.

## 1. Decision

Trello is classified as:

`HUMAN WORKBOARD / READ-ONLY EXTERNAL SOURCE`

Trello is **not** TigerIQ Control Plane, Company Source of Truth, AI Employee queue, runtime state store, engineering evidence store, or company memory.

The purpose of Trello is to remain a convenient human-facing Kanban/workboard for external/manual work while TigerIQ may read and summarize it when relevant.

## 2. Canonical control-plane sources

For company orchestration and NV session recovery, authoritative inputs are resolved from the applicable TigerIQ sources, including:
- Company Constitution;
- Workflow;
- AI Employee Model;
- Decision Log and current orchestration policy;
- GitHub Issues / PR / exact evidence / current-state pointers for repository and engineering work;
- canonical runtime/company state when implemented and applicable;
- approved domain-specific Sources of Truth.

Trello is excluded from this authoritative startup/control-plane set.

## 3. NV00 / CHAT00 startup rule

When Sếp opens or resumes `NV 00` / `CHAT00`:
1. Recover orchestration identity and current company policy.
2. Audit authoritative current assignments, handoffs, blockers and evidence.
3. Continue the highest-priority safe work or report the real blocker.
4. Do **not** open, search or audit Trello merely to determine what TigerIQ is doing.

Trello may be consulted only when:
- Sếp explicitly asks about Trello;
- the active business process explicitly declares Trello as an external input;
- an Owner Cockpit projection needs a Trello-derived human-work summary.

A Trello read must never override TigerIQ/GitHub/runtime truth for AI Employee state.

## 4. Allowed Trello use

Allowed:
- human-created work and deadlines;
- manual/external operational tasks;
- Kanban visibility for Sếp or collaborators;
- read-only aggregation into Owner Cockpit;
- deadline/overdue summaries with source provenance;
- explicit Owner-requested Trello maintenance when the requested write is clear and within authority.

## 5. Forbidden Trello use

Trello must not be used to:
- decide which NV/AI Employee is ACTIVE, BLOCKED, WAITING or DONE;
- assign or resume AI Employee work by default;
- store Job / Lease / Result / Evidence lifecycle authority;
- replace GitHub Issues/PR/CI for engineering work;
- replace canonical PostgreSQL/runtime/company state;
- act as AI memory or orchestration state;
- create a shadow work database;
- automatically write back TigerIQ internal state as if Trello were authoritative;
- resolve conflicts against a higher-precedence TigerIQ Source of Truth.

## 6. Read/write policy

Default integration mode is **READ-ONLY**.

TigerIQ may write to Trello only when one of these is true:
- Sếp explicitly requests the specific Trello change; or
- an approved business process explicitly grants bounded Trello write authority.

Even when a write is authorized, Trello remains an external human workboard. The write must not promote Trello into Control Plane or duplicate authoritative internal state.

## 7. Projection/provenance rule

If Trello data is shown in TigerIQ Web / Owner Cockpit:
- mark source as Trello/external;
- keep provenance/source reference where available;
- treat the projection as read-only/non-authoritative for TigerIQ internal execution state;
- authoritative TigerIQ state wins on conflict.

## 8. Regression requirements

The following behaviors are invalid:
- entering `NV 00` automatically triggers Trello audit;
- Trello card position/list changes cause AI Employee state transitions;
- stale Trello data overrides current GitHub Issue/PR/evidence;
- TigerIQ writes internal status back to Trello without explicit Owner/process authority.

The following behavior is required:
- `NV 00` resumes from TigerIQ authoritative state without Trello dependency;
- Trello is read only when relevant to a human-work query/process;
- explicit Trello writes remain possible when Sếp asks for them.

Marker: `TRELLO_EXTERNAL_WORKBOARD_BOUNDARY_READY`
