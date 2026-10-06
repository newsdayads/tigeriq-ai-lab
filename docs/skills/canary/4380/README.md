# #4380 Real Canary Evidence — 2026-10-06

Base main: `108a71e8bca3bc4253ac00de03b28ec0f6898a6a`
Work Order: #4380
Mode: repo-fixture first; bounded public research only where the skill genuinely requires external information.
No package install, no credential/cookie expansion, no Production/App Chrome mutation.

## document-normalization-ingest
**Input:** `docs/skills/learning-log/2026-09-23-agent-review-document-research.md` (already-decoded Markdown).

**Normalized result:** provenance retained; hashes remain `NOT_CAPTURED`; KEEP items = 8; IMPROVE items = 7; candidate skills produced = 6; promotion audit leaves 4 skills VALIDATED.

**Acceptance:** PASS — source facts/counts preserved and output is structured for downstream retrieval. Binary Office/PDF conversion was not claimed; the ACTIVE contract explicitly blocks when an approved converter is unavailable.

## source-grounded-knowledge-retrieval
**Question:** Which four skills remained VALIDATED in the 2026-09-27 promotion audit, and why?

**Grounded answer:** `document-normalization-ingest`, `source-grounded-knowledge-retrieval`, `external-research-capability-routing`, and `domain-skill-packaging`. The canonical learning log says each lacked sufficient measured execution/effectiveness evidence for ACTIVE promotion.

**Source:** `docs/skills/learning-log/2026-09-23-agent-review-document-research.md`, section `PROMOTION AUDIT — 2026-09-27`.

**Acceptance:** PASS — 4/4 IDs and the promotion-boundary reason are supported by one canonical repository source; no model-only claim is needed.

## external-research-capability-routing
**Question:** Does Microsoft MarkItDown support converting common files/Office documents to Markdown, and what I/O safety boundary matters?

**Routing decision:** external research required because the question asks about a public third-party project; route = bounded read-only public GitHub/web research; no login/cookie/credential expansion.

**Official sources read on 2026-10-06:**
- https://github.com/microsoft/markitdown/blob/main/packages/markitdown/README.md
- https://github.com/microsoft/markitdown/blob/main/README.md

**Grounded result:** PASS — official documentation describes MarkItDown as converting various files to Markdown and documents PDF/DOCX/PPTX-capable optional dependencies. Its security guidance says conversion uses the current process privileges and recommends the narrowest conversion function/privileges.

**Acceptance:** PASS — external access was justified, first-party source used, material claims source-backed, and no package install or credential/cookie use occurred.

## domain-skill-packaging
**Input:** current ACTIVE Skill Registry at base main.

**Pack result:**
- Engineering: `spec-first-tdd` → `minimal-change-output` → `automated-code-review-gate`.
- Design/UI: `design-system-memory` → `image-to-ui-implementation` → `visual-quality-gate`.
- Operations/orchestration: `context-budget-compaction` + `role-separated-execution` + `isolated-parallel-execution`.

**Gap rule:** Sales/Marketing/Finance-specific execution skills remain gaps; the canary does not invent replacements.

**Acceptance:** PASS — only existing ACTIVE skills are composed, no definitions are copied, no second scheduler/registry is introduced, and uncovered domains remain explicit.


## Promotion eligibility state semantics
The canary PASS step first yields `PROMOTION_READY + promotionEligible=true`. The proposed reviewed registry mutation then consumes that one-shot gate: terminal queue state becomes `ACTIVE + promotionEligible=false`, while the USE/MEASURE PASS evidence is retained. This prevents re-promoting an already ACTIVE skill and is the existing `reconcilePromotionQueue` contract, not a failed eligibility signal.
