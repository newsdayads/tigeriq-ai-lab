# TigerIQ Skill Learning Registry

Owner work: #859 - Skill Learning Registry — biến nội dung Owner gửi thành skill bền vững
Architecture parent: #822 - TigerIQ Goal-Driven Optimization Baseline — học từ video, không chạy theo xu hướng

## Lifecycle
INGEST → EXTRACT → CLASSIFY → DEDUPE → VALIDATE → PROMOTE → USE → MEASURE → RETIRE

## States
- CANDIDATE: extracted from a source but not yet proven for execution.
- VALIDATED: reviewed against TigerIQ architecture, safety and duplication.
- ACTIVE: approved for worker/runtime loading.
- DEPRECATED: superseded but retained for provenance.
- REJECTED: intentionally not adopted.

Allowed promotion path:
CANDIDATE → VALIDATED → ACTIVE → DEPRECATED
CANDIDATE/VALIDATED → REJECTED

## Provenance contract
Every learning batch must record:
- source_type;
- exact attachment filename or durable source reference;
- ingest date;
- source hash only when actually captured;
- extracted lesson and target component.

Never invent a URL, hash, timestamp or source identifier. Unknown values are omitted or explicitly marked NOT_CAPTURED.
Raw Owner video/file attachments are not copied into the repository by default.

## Runtime eligibility
Only ACTIVE skills may be auto-loaded by workers/runtime. CANDIDATE and VALIDATED entries are reference material only.
Workers should retrieve only skills relevant to the current objective; never preload the full registry.

## Promotion gate
Before a skill becomes ACTIVE:
1. no duplicate ACTIVE skill;
2. trigger/scope/output are explicit;
3. required capability/security boundary is declared;
4. measurable acceptance/evidence exists when execution behavior changes;
5. external skills have pinned provenance/version and installer/capability audit;
6. interruption/resume works from durable references without replaying full chat history.

## External skill security gate
Third-party skills/packages are untrusted by default.
Required before executable use: pinned source/version, license if applicable, installer/package-script audit, declared READ/WRITE/RUN/NETWORK capabilities, and review of config/permission changes.
Popularity/stars/downloads are discovery signals, not trust evidence.

## Resume rule
NEW CHAT or a different worker resumes from Source of Truth + registry + learning log/checkpoint references. Chat memory is not the durable store.
