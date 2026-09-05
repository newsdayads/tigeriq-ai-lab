# TigerIQ Owner AI Context v1

## Purpose
Make TigerIQ behave like a durable AI operating partner for the Owner without relying on replaying chat history or pretending conversational memory is authoritative.

## Architecture
`Dynamic Source of Truth + Owner Operating Profile + Decision Ledger + Goal Graph + Verified Lessons + HOT STATE -> Context Compiler -> employee/task context`

Only the compiled relevant slice is injected into an employee/task. Full history is never a normal startup dependency.

## Memory classes
1. **Operating rules** — stable non-sensitive ways of working explicitly set by Owner or verified by repeated evidence.
2. **Decisions** — effective decisions with supersede chains; only ACTIVE decisions compile.
3. **Goals** — long-term goal graph linking programs/work/evidence.
4. **Rejections / Do-Not-Repeat** — fingerprints of rejected approaches so the system does not repeatedly propose the same unhelpful action.
5. **Verified lessons** — interaction/operational learnings promoted only through a learning gate.

## Learning gate
Conversation does not automatically become truth.
- One-off observation -> CANDIDATE.
- Explicit Owner instruction -> eligible for VERIFIED.
- Non-explicit pattern -> requires repeated observations plus evidence pointers.
- Contradicted/stale knowledge -> RETIRED/superseded.

## Context compiler
The compiler selects only context whose tags overlap the current task plus global operating rules, then applies a strict item budget. The result must be deterministic for the same state/input.

This solves two problems at once:
- continuity across chats/employees without asking Owner to repeat known working preferences;
- performance/privacy by avoiding irrelevant memory and large history replay.

## Privacy boundary
The project repository is not a personal-data vault. By default it stores only non-sensitive operating context. Health/medical, personal financial identifiers, family-private details, credentials/secrets, government IDs, biometrics and precise private addresses are excluded from repository memory unless a future dedicated private storage design and explicit policy permit them.

## Advisor mode
TigerIQ should proactively help development, but advice is not authority. Recommendations should distinguish:
- **FACT** — supported by current Source of Truth/evidence;
- **INFERENCE** — reasoned but not directly verified;
- **RECOMMENDATION** — proposed action with expected impact/risk.

The advisor may create reversible OFF-MAIN improvement candidates within authority, but may not self-authorize Production, spend, credentials/security-boundary changes, reboots or irreversible actions.

## Cross-chat continuity contract
A new chat/employee should recover by loading:
1. current dynamic Source of Truth / Context Plane;
2. compact compiled Owner context for the task;
3. employee HOT STATE/checkpoint.

It should not replay full chat history or require Owner to restate stable operating preferences/decisions that are already persisted.

## Strategic extension
The recommended next maturity level is an **Owner Digital Twin (bounded)**: not a simulation of the person, but a structured decision-support model containing goals, operating preferences, current commitments, decision history, rejected patterns and verified lessons. It remains bounded by evidence, privacy, explicit authority and easy correction/forgetting.

## Rollout
Candidate -> CI -> shadow compilation -> cross-chat comparison -> canary for one employee -> fleet. Rollback is deletion/disable of compiled-context injection; current Source of Truth remains authoritative throughout.
