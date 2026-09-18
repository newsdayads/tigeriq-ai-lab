# Skill Contract: INGEST → EXTRACT → CLASSIFY → DEDUPE → VALIDATE → PROMOTE → USE → MEASURE → RETIRE

This contract defines a durable lifecycle for skill artifacts stored in the **docs/skills** registry.

## Lifecycle States
- **CANDIDATE** – newly ingested, pending validation.
- **VALIDATED** – passed automated and manual checks.
- **ACTIVE** – eligible for runtime execution and chat/resume.
- **DEPRECATED** – superseded but retained for history.
- **REJECTED** – failed validation, archived.

State transitions must follow:
`CANDIDATE → VALIDATED → ACTIVE → (DEPRECATED | REJECTED) → RETIRE`

## Versioning & Security Gates
- Every change creates a new `version` (semantic `MAJOR.MINOR.PATCH`).
- Security gates enforce:
  * No raw video binaries are stored; only provenance URLs and hashes.
  * Only `ACTIVE` entries are loaded by the execution engine.

## Provenance Tracking
Each skill entry records:
- `id`, `title`, `source_url`, `source_hash`, `ingest_timestamp`, `owner`, `state`, `version`.

## Runtime Eligibility
Only entries with `state: ACTIVE` are considered by the chat and execution resume subsystems.