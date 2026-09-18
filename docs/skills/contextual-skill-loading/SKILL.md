# Contextual Skill Loading

Status: ACTIVE
Issue: #903 - Promote Contextual Skill Loading from #864 live evidence
Implementation evidence: #864 - Active Skill Loader — Core chỉ nạp skill ACTIVE đúng việc
Target: core-context-routing

## Apply when
A Core/Manager objective needs reusable operational guidance from the Skill Registry.

## Rules
- Load only skills with registry state `ACTIVE`.
- Require positive relevance to the current objective; irrelevant ACTIVE skills are not loaded.
- Never preload the complete Skill Registry or every SKILL.md.
- Keep the selected bundle bounded; current loader hard-caps the number of skills and context size.
- Missing/malformed registry or missing SKILL.md fails closed; do not substitute CANDIDATE content.
- Emit durable evidence of loaded skill IDs and context size.
- Skill selection does not grant new authority; Production, paid, credential/security, destructive and irreversible gates remain unchanged.

## Evidence
- #864 source implementation and closeout
- PR #870 — relevant ACTIVE skill loader merged and independently reviewed
- `apps/tigeriq-core/skill-loader.mjs`
- `tests/core-skill-loader.test.ts`
- live runtime events `SKILL_CONTEXT_LOADED`
  - role-separated-execution loaded alone when only review/orchestration matched
  - role-separated-execution + capability-aware-model-routing loaded together when both matched

## Non-goals
This skill does not promote other skills, install external skills, preload unrelated knowledge, modify APP Chrome/Worker Utility, or expand authorization.
