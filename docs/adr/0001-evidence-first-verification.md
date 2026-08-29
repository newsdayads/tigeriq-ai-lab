# ADR 0001: Evidence-first verification

- Status: Accepted
- Date: 2026-08-29

## Context

Language-model assertions are probabilistic and cannot establish that software meets acceptance criteria.

## Decision

All completion decisions require referenced evidence evaluated by a gate actor independent from the implementer. The Coding Agent can report `IMPLEMENTED`, never `VERIFIED` or `DONE`.

## Consequences

Work may remain incomplete when evidence is unavailable even if implementation appears correct. This deliberate fail-closed behavior makes decisions auditable and reproducible.
