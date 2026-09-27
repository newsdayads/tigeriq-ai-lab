# Owner agent/review/document/research learning log — 2026-09-23

Owner work: #1566 - Ingest 2026-09-23 agent/review/document/research lessons
Skill registry parent: #859 - Skill Learning Registry — biến nội dung Owner gửi thành skill bền vững
Architecture parent: #822 - TigerIQ Goal-Driven Optimization Baseline — học từ video, không chạy theo xu hướng

## Provenance
Source type: ChatGPT attachments + Owner inline screenshots + verified public GitHub README references.
Ingest date: 2026-09-23.
Raw attachments copied to repository: NO.
Hashes: NOT_CAPTURED. No URL/hash/filename is invented.

Owner attachment filenames captured in this batch:
- `v29025g50000damtv1vog65jem30h6bg.mp4`
- `v102ffg50001dap6vovog65pf4j55cng.mp4`
- `v14025g50000danmskfog65hmoa1ncgg.mp4`
- Additional Owner inline screenshots in the same chat: filename NOT_CAPTURED.

Verified public repositories used to validate the visible claims:
- `microsoft/markitdown`
- `blader/humanizer`
- `addyosmani/agent-skills`
- `Panniantong/Agent-Reach`
- `Tencent/WeKnora`
- `stablyai/orca`
- `ayghri/i-have-adhd`
- `affaan-m/ECC`
- `bilawalsidhu/gods-eye-view`
- `alibaba/open-code-review`

## Source-supported observations
- Orca runs multiple coding agents side-by-side with isolated Git worktrees and exposes monitoring/steering from mobile.
- Addy Osmani Agent Skills packages engineering workflows around DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP and preserves verification during autonomous build.
- OpenCodeReview is an AI code-review CLI intended for repository-aware review and supports multiple coding-agent ecosystems.
- MarkItDown converts common document/media formats into Markdown for LLM/text-analysis pipelines and explicitly warns to use narrow I/O privileges.
- WeKnora provides document ingestion, RAG/retrieval, agent reasoning and wiki-like knowledge curation.
- Agent-Reach packages internet/research access for agents across external platforms; its external-access nature implies capability/security gating.
- Humanizer and i-have-adhd focus on output style/clarity, not execution correctness.
- ECC presents a broad agent-harness approach with reusable engineering skills/tools.
- God's Eye View is primarily a browser-based geospatial/live-data visualization product; it is not an orchestration or code-quality primitive.

## KEEP
1. Goal-driven orchestration: Owner supplies outcome/constraints; the system decomposes, routes, executes, reviews and verifies.
2. Parallel work must be isolated by resource scope/worktree/branch so workers cannot silently overwrite each other.
3. Independent code review should be an explicit quality gate, not a self-review by the same executor.
4. Engineering know-how should be packaged as reusable skills and loaded only when relevant.
5. Documents should be normalized into LLM-friendly structured text before downstream retrieval/reasoning.
6. Knowledge retrieval may use RAG/indexing, but durable Source of Truth remains GitHub/TigerIQ authority.
7. Research/internet tools are capabilities, not autonomous authorities; access must be bounded by permissions and evidence.
8. Domain packs such as Marketing are useful only when they reuse the same Skill Registry, ownership and review contracts.

## IMPROVE for TigerIQ
1. Add an isolated-parallel-execution candidate for worktree/resource isolation patterns, while preserving one-resource-one-active-mutation-owner.
2. Add an automated-code-review-gate candidate that can evaluate diffs/repository context independently before merge.
3. Add a document-normalization-ingest candidate inspired by MarkItDown; evaluate format coverage, security boundary and quality before integration.
4. Add a source-grounded-knowledge-retrieval candidate for large document collections; it must cite durable source refs and never replace canonical state.
5. Add an external-research-capability-routing candidate: route research tools only when the objective requires them and isolate cookies/credentials/network scope.
6. Add a domain-skill-packaging candidate so Marketing/Sales/Research skills can be activated by department without expanding Core orchestration authority.
7. Reuse existing active skills for spec/TDD, role separation, external-skill security, minimal-change output and capability-aware model routing instead of duplicating them.

## DEDUPE — no new skill
- Multi-agent Lead/Orchestrator/Auditor pattern → existing `role-separated-execution` + current Core dynamic capability routing.
- ECC/Agent Skills planning/test/review patterns → existing `spec-first-tdd`, `role-separated-execution`, `minimal-change-output`, `capability-aware-model-routing`.
- i-have-adhd action-first/no-preamble pattern → existing TigerIQ NO YAPPING interaction contract; no runtime skill needed.
- Humanizer → optional department/content reference only; correctness/evidence rules remain authoritative.
- UI/geospatial ideas from God's Eye View → product/UI reference only; no Core skill.

## REJECT / DEFER
- Installing the whole “30 tools/skills” list.
- Replacing TigerIQ Core with Orca/ECC/another orchestration platform without a measured gap and migration proof.
- Treating RAG or vector search as authoritative state.
- Loading every skill into every worker.
- Giving research/scraping tools broad cookies, credentials or network permissions by default.
- Promoting any third-party tool to ACTIVE because of stars/trending status.
- Letting style tools rewrite factual evidence, logs or code-review findings.
- Integrating God's Eye View into TigerIQ Core; only borrow UI/data-layer ideas if a product need appears.

## Candidate skills produced
- `isolated-parallel-execution`
- `automated-code-review-gate`
- `document-normalization-ingest`
- `source-grounded-knowledge-retrieval`
- `external-research-capability-routing`
- `domain-skill-packaging`

All six remain CANDIDATE. This batch installs no external package and activates no runtime behavior.
