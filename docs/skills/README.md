# TigerIQ Skill Learning Registry

Issue owner: #859 - Skill Learning Registry — biến nội dung Owner gửi thành skill bền vững

## Purpose
Turn Owner-provided videos/files/notes into durable, reviewable skills instead of leaving knowledge only in chat memory.

## Pipeline
INGEST → EXTRACT → CLASSIFY → DEDUPE → VALIDATE → PROMOTE → USE → MEASURE → RETIRE

## Storage
- `registry.yaml`: machine-readable skill/lesson registry.
- `learning-log/`: source-derived lessons, provenance, KEEP/IMPROVE/REJECT.
- `<skill-id>/SKILL.md`: promoted skill contract.

Raw Owner attachments are not copied into the repository by default. Store only provenance (source type, filename, date) plus distilled notes unless retention is explicitly required.

## States
- CANDIDATE: extracted but not yet proven as an operational skill.
- VALIDATED: reviewed against TigerIQ pain/architecture and accepted for implementation.
- ACTIVE: safe for runtime/worker loading.
- DEPRECATED: superseded.
- REJECTED: not suitable for TigerIQ.

## Promotion gate
A CANDIDATE may become ACTIVE only when:
1. scope and trigger are explicit;
2. source/provenance is recorded;
3. no duplicate active skill exists;
4. capability/security boundary is declared;
5. measurable acceptance/evidence exists when execution behavior changes;
6. runtime integration has been verified.

## External skill safety
External packages/repos are discovery inputs, not trusted code. Pin provenance/version, audit installer/scripts and capability needs, default to read-only reference, and never allow permission/security changes without the applicable authorization gate.

## Context rule
Workers should load only the ACTIVE skills relevant to the current objective. Do not preload the whole skill library.
