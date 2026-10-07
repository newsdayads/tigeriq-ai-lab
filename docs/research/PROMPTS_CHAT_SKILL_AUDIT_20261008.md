# Audit prompts.chat -> TigerIQ Skill Candidates

Work item: #4534 - [P2][SKILL][PROMPTS.CHAT] Xây thư viện kỹ năng TigerIQ từ kho prompt cộng đồng

## Source snapshot
- Repository: `f/prompts.chat`
- Branch: `main`
- Tree snapshot: `7d3f248962d1dca209d59e033524bcb86c2b26b8`
- Dataset: `prompts.csv`
- Dataset blob: `3b985c0084fb28e1b9acace419ed34696ac63a92`
- License: prompt content/data is CC0 1.0 Universal; source code is MIT.
- Records parsed: 2,169
- Schema: `act,prompt,for_devs,type,contributor`
- Malformed CSV rows: 0
- Blank act: 0
- Blank prompt: 0

## Hygiene
- Exact duplicate prompt extra rows: 4
- Prompts shorter than 80 chars: 29
- Prompts longer than 12,000 chars: 94
- Rows matching conservative manual-review risk heuristics: 222
- Contributor values that look like email addresses: 1,104
- Contributor PII is never copied into TigerIQ candidate skills.

Deterministic first-pass buckets:
- AUTO_DROP: 33 / 2,169 = 1.52% (duplicate extras or too-short prompts)
- MANUAL_REVIEW: 275 / 2,169 = 12.68% (remaining risky or excessive-length rows)
- ELIGIBLE_POOL: 1,861 / 2,169 = 85.80%

These are ingestion hygiene buckets, not final quality ratings. Safety categories overlap and must be re-reviewed before promotion.

## Heuristic single-label taxonomy
The taxonomy is only for triage; it is not imported as runtime authority.

| Group | Count |
|---|---:|
| coding | 664 |
| testing_quality | 180 |
| research_analysis | 247 |
| data | 111 |
| writing_content | 236 |
| business_product | 70 |
| design_ux_media | 397 |
| education_coaching | 32 |
| security | 3 |
| personal_lifestyle | 25 |
| other | 204 |

Risk-tag counts are multi-label and therefore do not sum to 2,169:
- adult: 17
- cyber-sensitive: 32
- medical: 44
- financial: 106
- legal: 9
- prompt-injection-like: 32
- excessive length: 94

## Conversion policy
A community prompt is not a TigerIQ skill until it has:
1. bounded trigger;
2. explicit inputs;
3. ordered steps;
4. deterministic output contract;
5. acceptance criteria;
6. evidence requirements;
7. fallback/stop conditions;
8. safety boundaries;
9. provenance;
10. CANDIDATE state with runtime eligibility INACTIVE.

No raw prompt is mass-loaded into Core. No candidate is added to a runtime registry in this work item.

## Candidate set
Six low-risk, high-reuse candidates were normalized:
1. `community-code-reviewer` from act `Code Reviewer`
2. `community-software-qa` from act `Software Quality Assurance Tester`
3. `community-solution-architect` from act `IT Architect`
4. `community-product-requirements` from act `Product Manager`
5. `community-research-synthesizer` from act `LLM Researcher`
6. `community-technical-writer` from act `Tech Writer`

## Sample contract benchmark
Rubric: 7 dimensions, 0-2 each, max 14:
- bounded trigger
- explicit input
- ordered steps
- output contract
- acceptance
- evidence
- safety/stop

| Candidate | Raw prompt | Normalized candidate |
|---|---:|---:|
| community-code-reviewer | 4/14 | 14/14 |
| community-software-qa | 6/14 | 14/14 |
| community-solution-architect | 5/14 | 14/14 |
| community-product-requirements | 6/14 | 14/14 |
| community-research-synthesizer | 5/14 | 14/14 |
| community-technical-writer | 5/14 | 14/14 |

This benchmark validates contract completeness only. It does not claim live model quality, latency, cost, or task success.

## Promotion plan
1. Keep these six skills CANDIDATE and INACTIVE.
2. Select one candidate at a time for bounded benchmark tasks.
3. Compare against the current no-skill baseline using the same inputs.
4. Require task correctness + output-contract compliance + no policy violation.
5. Only after reviewed evidence, promote one skill through the existing TigerIQ skill registry path.
6. Roll back by removing the registry promotion; candidate documentation may remain as provenance.

## Result
- Source inventory: PASS
- Structural parse: PASS
- Dedup/hygiene pass: PASS
- Taxonomy: PASS for triage
- Candidate normalization: PASS
- Static benchmark: PASS
- Runtime activation: NOT PERFORMED
- Core/App Chrome mutation: NONE
- Codex use: NONE
