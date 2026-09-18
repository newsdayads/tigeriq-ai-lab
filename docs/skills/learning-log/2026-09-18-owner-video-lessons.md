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


## Batch extension — 2026-09-18 — Codex workspace memory + CLI-Anything

### Provenance
- v1c044g50000d9qgcbvog65sr8ecpueg.mp4
  - SHA-256: fb5074aa612cf3a2f17e7f3458d42a2f8b13695e964d6879fa173ebeeff05105
- v29025g50000da0n5b7og65jujo8utdg.mp4
  - SHA-256: bd450971468b1d5546e103d42c6608a13819b75f7876c9c58014c23ebc2f851b

External validation source for the second video:
- https://github.com/HKUDS/CLI-Anything
- Official project documentation/security policy reviewed on 2026-09-18.

### Source-derived lessons — Codex workspace / durable learning
KEEP:
- Give an agent a bounded project workspace and durable project instructions instead of relying on conversational memory.
- Keep a structured failure/feedback log containing date, project, problem, user dissatisfaction, root cause, prevention and resolution status.
- Reuse naming conventions and project-specific rules across sessions.

IMPROVE:
- Use repository-scoped instructions and Source of Truth references, not an unbounded whole-computer scan.
- Treat a failure log as input to learn-from-failure promotion: recurring patterns must become checks/rules/skills with evidence.
- Keep top-level instructions small and use them as a map to deeper canonical documents rather than one giant memory file.

REJECT:
- “Scan the whole computer” as a default operating model.
- Claiming the AI automatically becomes smarter merely because files exist; durable learning requires explicit write, retrieval, validation and reuse.
- Creating a second shadow memory system that competes with CURRENT_STATE/CENTRAL/issues/evidence.

DEDUPLICATION:
- No new project-memory skill is created. These lessons strengthen existing `learn-from-failure`, `contextual-skill-loading` and durable Source of Truth architecture.

### Source-derived lessons — CLI-Anything
KEEP:
- A CLI harness is often a better agent interface than pixel/mouse automation when the target software exposes a usable backend/API.
- Machine-readable JSON output, one-shot commands, help/discovery and deterministic state improve agent reliability.
- Generate software-specific skill documentation together with the harness so agents can discover how to use it.

IMPROVE:
- Treat third-party harness builders as untrusted supply-chain inputs until pinned and audited.
- Prefer target software's real backend over reimplementing business logic.
- Validate exported/rendered artifacts, not only process exit codes.
- Pilot on an isolated non-production desktop application before considering broader PC01 integration.

REJECT:
- The video's implication that arbitrary GUI software can universally be controlled safely after one command.
- Replacing TigerIQ Chrome Controller or APP Chrome merely because a generic harness exists.
- Granting filesystem, command or network privileges to generated harnesses without capability review.

### External validation findings for CLI-Anything
- Official project supports building stateful CLI harnesses from a local source path or GitHub repository and documents OpenClaw and Codex integration.
- The official README currently describes 18 professional demos and 2,280 passing tests; this is strong evidence of breadth, not proof of universal application coverage.
- The project security policy explicitly treats agent-to-desktop control as a threat surface and requires safer subprocess/path/secret handling.
- Closed-source/web-service wrapping remains a roadmap direction; therefore “all software” is an aspiration, not a current guarantee.

## Candidate added
- agent-native-cli-harness — CANDIDATE only; safe pattern for evaluating/generating deterministic CLI adapters for desktop software. It is not authorized for automatic installation or PC01 production use.


## Batch extension — 2026-09-18 — Skill / Tool / Memory triad

### Provenance
- v1c044g50000d9323tnog65ktbcn248g.mp4
  - SHA-256: 11fe8eb58594b06288fb14e681a0e719de63c1c0a67de0e85794854c264e86f2

### Source-derived model
The video separates three concerns for an AI agent:
- SKILL: what the agent knows how to do; examples shown include content, sales and R&D specialization.
- TOOL: what the agent can use to act or retrieve information; examples shown include document/file access, web search, email, Google Drive and APIs.
- MEMORY: what the agent retains across work; examples shown include tone of voice, rules, project/user context, decisions and accumulated handling experience.

The video's mnemonic is: SKILL = biết làm gì; TOOL = làm bằng gì; MEMORY = nhớ điều gì.

### KEEP
- Preserve the separation between capability, action interface and durable context/state.
- Treat good agent performance as a composition of the right capability + the right tool access + the right retained context, rather than assuming a strong model alone is sufficient.
- Keep role-specific skills bounded: e.g. content/sales/R&D are different capabilities even if they can share some tools.
- Memory should accumulate useful project/user/rule/decision context that improves continuity over time.

### IMPROVE FOR TIGERIQ
- Map SKILL to Dynamic AI Employee Registry capabilities + ACTIVE skills in the Skill Registry.
- Map TOOL to explicit connector/API/runtime capabilities with permission and security gates.
- Map MEMORY to authoritative Source of Truth, CURRENT_STATE, issues/Work Orders, checkpoints and evidence; raw chat history remains non-authoritative.
- Add a preflight contract for executable Work Orders: required_skill, required_tools, required_state_refs. If any required element is missing, route/fail closed instead of pretending the employee can execute.
- Keep tool permissions separate from employee identity: having a tool available does not imply every employee may use it.
- Retrieve memory/context just in time; do not preload all history into every worker call.

### REJECT
- Treating MEMORY as unlimited chat transcript or model recollection.
- Treating TOOL access as proof of competence.
- Treating SKILL text alone as executable capability when the required tool or permission is absent.
- Giving every agent every tool “just in case”.

### External cross-check
Anthropic's production-agent guidance describes the core augmented-LLM building block as combining retrieval, tools and memory, and separately stresses that tools should have clear, non-overlapping purposes and context-efficient outputs. This supports the video's separation model, while TigerIQ keeps stronger durability and authorization boundaries.

### Deduplication decision
No new standalone skill is created. This video clarifies the architecture binding among existing Skill Registry, AI Employee capabilities, tool permissions and durable state. It strengthens `contextual-skill-loading`, `role-separated-execution`, `capability-aware-model-routing` and the Source of Truth contract without creating a parallel agent framework.
