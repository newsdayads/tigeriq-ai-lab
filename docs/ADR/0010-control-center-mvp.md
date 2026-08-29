# ADR 0010 — Local Evidence-Backed Control Center

Status: Accepted for WO-003 branch; superseded operationally by ADR 0011 for WO-010 and later work.

## Decision
The first Control Center is a read-only loopback web surface built directly from Control Plane snapshots. It exposes human-readable HTML and machine-readable JSON without adding mutation endpoints or external hosting.

## Rationale
Owner visibility is required before broader automation. Reading the runtime source of truth avoids duplicating state into the dashboard and preserves evidence-first semantics. Local-only serving avoids introducing a new public authentication/TLS boundary during the MVP.

## Consequences
- Control Plane implementations expose latest Work Order snapshots through `list()`.
- Dashboard derives active, blocked, failing-gate, evidence and release-eligibility metrics.
- Public deployment, remote access and write controls remain separately gated.
- From WO-010 onward, ADR 0011 makes Command Center the primary operational/reporting surface and removes Trello from the mandatory execution path.
