# Owner video learning log — 2026-09-18

Owner work: #859 - Skill Learning Registry — biến nội dung Owner gửi thành skill bền vững
Architecture parent: #822 - TigerIQ Goal-Driven Optimization Baseline — học từ video, không chạy theo xu hướng

## Provenance
Source type: ChatGPT attachments supplied by Owner.
Ingest date: 2026-09-18.
Raw attachments copied to repository: NO.
Hashes: NOT_CAPTURED. No URL/hash is invented.

Files in this learning batch:
- v14044g50000daklphvog65tn29ogksg.mp4
- v102ffg50001d9tgtj7og65ms8ca8f10.mp4
- v29025g50000dagbbenog65gahgdtid0.mp4
- v14044g50000d9k95evog65tfldn124g.mp4
- v14044g50000d9uishnog65ous22rkd0.mp4
- v14044g50000daeauqfog65m4sf8hce0.mp4

The videos were reviewed as one Owner learning batch. Where a lesson cannot be attributed safely to one exact filename, this log preserves batch-level provenance rather than inventing a per-file mapping.

## KEEP
- Load only the skill/context relevant to the current objective.
- Durable Source of Truth/checkpoints instead of dependence on full chat history.
- Goal/SPEC/acceptance before source mutation.
- For suitable bug fixes: RED regression evidence → minimal fix → GREEN evidence.
- Separate planner/implementer/reviewer roles when useful; independent review for source changes.
- Convert recurring failures into durable rules/checks/skills.
- Prefer minimal scoped diffs over unnecessary whole-file rewrites.
- Route models by task difficulty/capability/latency/cost.

## IMPROVE
- Add relevance-filtered context bundles, headroom budgets and milestone compaction.
- Add machine-readable skill lifecycle and ACTIVE-only runtime eligibility.
- Add external-skill provenance/version/capability/security intake gates.
- Make NEW CHAT/worker resume from durable plan/checkpoint/registry references.
- Measure token/context waste, retries, completion quality and skill effectiveness before promotion.

## REJECT
- One giant prompt/context shared by every worker.
- One chat expected to contain an entire long-running project.
- Blind truncation that drops acceptance, ownership or evidence.
- TDD theater written only after the implementation.
- Installing third-party skills/packages based on popularity without audit.
- Auto-updating floating latest third-party skills.
- Spawning extra agents without clear ownership and measurable benefit.
- Rewriting entire files when a local diff is sufficient.

## Candidate skills created
- contextual-skill-loading
- context-budget-compaction
- spec-first-tdd
- learn-from-failure
- role-separated-execution
- external-skill-security-gate
- minimal-change-output
- capability-aware-model-routing

These remain CANDIDATE. They are not ACTIVE merely because they appear in this log or registry.
