# Skill Contract: INGEST → EXTRACT → CLASSIFY → DEDUPE → VALIDATE → PROMOTE → USE → MEASURE → RETIRE

This contract defines a durable lifecycle for skill artifacts stored in the **docs/skills** registry.

Pipeline Definition:
INGEST → EXTRACT → CLASSIFY → DEDUPE → VALIDATE → PROMOTE → USE → MEASURE → RETIRE

## Lifecycle States & Eligibility
- **CANDIDATE** – newly ingested, pending validation.
- **VALIDATED** – passed automated and manual checks.
- **ACTIVE** – eligible for runtime execution and chat/resume. **Only ACTIVE-only eligibility** is permitted for runtime execution subsystems.
- **DEPRECATED** – superseded but retained for history.
- **REJECTED** – failed validation, archived.

State transitions must follow:
`CANDIDATE → VALIDATED → ACTIVE → (DEPRECATED | REJECTED) → RETIRE`

## Versioning & External Skill Security Gate
- Every change creates a new `version` (semantic `MAJOR.MINOR.PATCH`).
- External skill security gate notes:
  * No raw video binaries or untrusted external binaries are stored; only verified provenance references.
  * All external inputs pass strict validation before promotion.
  * Only `ACTIVE` entries are loaded by the execution engine.

## Provenance Tracking
Each skill entry records:
- `id`, `title`, `source_url`, `source_hash`, `ingest_timestamp`, `owner`, `state`, `version`.