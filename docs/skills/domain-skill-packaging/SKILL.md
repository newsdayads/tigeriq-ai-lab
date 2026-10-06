# Domain Skill Packaging

## Identity
- ID: domain-skill-packaging
- Version: 1.0.0
- State: ACTIVE
- Target: skill-system
- Provenance: registry.yaml; learning-log/2026-09-23-agent-review-document-research.md; canary #4380

## Trigger
Use when reusable skills need to be grouped for a department/domain without creating a second orchestration system or duplicating existing skills.

## Input
- Domain objective and task classes.
- Current Skill Registry states/contracts.
- Required capability, safety, ownership, and review boundaries.

## Steps
1. Inventory ACTIVE skills relevant to the domain.
2. Reuse existing skills before proposing any new one.
3. Package only references/composition rules; do not fork skill definitions.
4. Record real gaps explicitly instead of inventing coverage.
5. Keep execution, security, review, and promotion authority in existing TigerIQ contracts.

## Tools / Output
Use the existing Skill Registry and durable repository docs. Output a domain pack manifest listing reused skill IDs, triggers/use order, gaps, and inherited boundaries.

## Acceptance
- Every referenced skill exists and is eligible for the stated use.
- No duplicate skill definition or second scheduler/registry is created.
- Gaps remain explicit.
- Pack composition cannot expand the authority of its component skills.

## Evidence
- #4380 repo-fixture canary packaged Engineering, Design/UI, and Operations compositions from existing ACTIVE skills with zero duplicate/new authority.
- docs/skills/canary/4380/README.md
- docs/skills/canary/4380/evidence.json

## Fallback
If a domain has no adequate ACTIVE skill, return a gap record and keep any proposed new skill CANDIDATE/VALIDATED until its own evidence gate passes.

## Safety
Packaging never bypasses credential, Production, financial, destructive, security, or independent-review gates.

## Non-goals
This skill does not create a new orchestration authority, auto-promote missing skills, or clone generic skills under department-specific names.
