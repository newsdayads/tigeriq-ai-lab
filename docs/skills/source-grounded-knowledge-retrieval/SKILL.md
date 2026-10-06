# Source-Grounded Knowledge Retrieval

## Identity
- ID: source-grounded-knowledge-retrieval
- Version: 1.0.0
- State: ACTIVE
- Target: knowledge-system
- Provenance: registry.yaml; learning-log/2026-09-23-agent-review-document-research.md; canary #4380

## Trigger
Use when an answer or decision must be retrieved from a bounded document/repository corpus and remain traceable to durable source references.

## Input
- A concrete question.
- An allowed corpus or source set.
- Source-of-Truth precedence rules.

## Steps
1. Identify the smallest relevant source set.
2. Retrieve matching passages/records without replacing canonical operational state.
3. Form claims only from retrieved evidence.
4. Attach durable source references to each material claim.
5. Mark unsupported points as unknown instead of filling gaps.

## Tools / Output
Use existing repository/document search and read surfaces. Output concise grounded claims with durable source paths/refs and any unresolved gaps.

## Acceptance
- Every material claim is supported by the retrieved corpus.
- Canonical GitHub/TigerIQ state keeps precedence over derived indexes.
- No source is silently substituted with model knowledge.
- Retrieval remains bounded to the task.

## Evidence
- #4380 real repository retrieval canary answered the four VALIDATED-skill promotion question from the canonical 2026-09-23 learning log with exact source refs.
- docs/skills/canary/4380/README.md
- docs/skills/canary/4380/evidence.json

## Fallback
If the corpus is unavailable or does not support the requested claim, return the known sources plus UNKNOWN/BLOCKED_EVIDENCE.

## Safety
Do not treat RAG/index/search output as authoritative when it conflicts with the declared Source of Truth.

## Non-goals
This skill does not create facts, rewrite canonical state, or grant mutation authority to retrieval systems.
