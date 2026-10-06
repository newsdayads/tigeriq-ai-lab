# Document Normalization Ingest

## Identity
- ID: document-normalization-ingest
- Version: 1.0.0
- State: ACTIVE
- Target: knowledge-ingest
- Provenance: registry.yaml; learning-log/2026-09-23-agent-review-document-research.md; canary #4380

## Trigger
Use when a document or already-decoded text must be normalized into structured LLM-friendly text before retrieval or reasoning.

## Input
- A supported document/text source with a durable source reference.
- The required output structure and preservation constraints.
- Any available approved converter capability for binary formats.

## Steps
1. Pin the input source and format.
2. Use the narrowest available read/convert capability; for already-decoded text/Markdown, normalize structure without changing facts.
3. Preserve headings, tables/lists, provenance, and explicit unknown values.
4. Verify factual preservation against the source.
5. Emit normalized text plus source/evidence references.

## Tools / Output
Use existing document/file readers or approved converters only. Output structured Markdown/text with the original source reference and a short normalization evidence record.

## Acceptance
- Source provenance is preserved.
- No unsupported facts are introduced.
- Structure is stable enough for downstream retrieval/reasoning.
- Binary formats are processed only when an approved converter exists; otherwise the task blocks explicitly.

## Evidence
- #4380 real repo-fixture canary normalized the 2026-09-23 learning log and preserved measurable section/item counts.
- docs/skills/canary/4380/README.md
- docs/skills/canary/4380/evidence.json

## Fallback
If the format cannot be decoded with an approved narrow-I/O capability, keep the source unchanged and return BLOCKED_EVIDENCE with the missing converter/capability.

## Safety
Do not install external converters, broaden filesystem/network access, or expose credentials merely to complete normalization.

## Non-goals
This skill does not perform OCR by default, invent missing content, or make normalized text authoritative over the original source.
