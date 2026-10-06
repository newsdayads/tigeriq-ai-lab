# External Research Capability Routing

## Identity
- ID: external-research-capability-routing
- Version: 1.0.0
- State: ACTIVE
- Target: research
- Provenance: registry.yaml; learning-log/2026-09-23-agent-review-document-research.md; canary #4380

## Trigger
Use when the objective needs current/public information that the approved local or project sources do not provide.

## Input
- Research question and freshness requirement.
- Allowed public source classes/domains.
- Network, cookie, credential, and privacy boundaries.

## Steps
1. Decide whether external research is actually required.
2. Choose the narrowest read-only research capability that can answer the question.
3. Prefer first-party/official sources for factual product or repository claims.
4. Do not broaden cookie, credential, login, or network permissions.
5. Return source-backed findings and record which external capability was used.

## Tools / Output
Use approved public web/repository research surfaces only when needed. Output concise findings with source URLs/references, freshness, and boundary evidence.

## Acceptance
- External access is justified by the task.
- Sources support the material claims.
- No credential/cookie expansion or package installation occurs.
- Results are clearly separated from canonical internal operational state.

## Evidence
- #4380 live public-research canary routed to official microsoft/markitdown GitHub documentation and verified conversion capability plus narrow-I/O safety guidance without login/cookies/credentials.
- docs/skills/canary/4380/README.md
- docs/skills/canary/4380/evidence.json

## Fallback
If external access is unavailable or would cross a credential/security boundary, return BLOCKED_EVIDENCE and the exact dependency.

## Safety
Public research is read-only; never grant broad cookies, credentials, or account access by default. External packages remain subject to the external-skill security gate.

## Non-goals
This skill does not authorize scraping behind authentication, package installation, or replacement of TigerIQ Source of Truth.
