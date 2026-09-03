# TIGERIQ — DECISION LOG / BASELINE
Version: 1.1

## Confirmed operating decisions
- TigerIQ is intended to become an AI-native company/operating system, not merely a chatbot.
- Chief of Staff is the primary orchestration role.
- The system should combine multiple AI providers/models rather than depend on one model.
- Low-cost/free-first is the default.
- Execution must be evidence-driven and independently checked for material work.
- “LÀM” means execute continuously through applicable gates; do not repeatedly stop for confirmation.
- Production changes require the appropriate release authorization/gate.
- Current engineering baseline includes orchestration, work-order concepts, evidence, control-plane/runtime safeguards, and model-routing foundations.
- Existing assets should be evaluated for monetization, but no asset should be activated without economic justification.
- TigerIQ Driver is an important real-world product/use case and originated from an operational need to record rides and settle revenue sharing.
- The Owner wants the system to progressively control personal/business workflows while preserving explicit privacy boundaries.

## Project integration decisions
- 2026-09-03: Trello is removed from TigerIQ AI Lab project operation. It is not a Source of Truth, Control Plane input, AI Employee queue, Owner Cockpit data source, workboard dependency, startup dependency, runtime dependency, or reporting source.
- 2026-09-03: TigerIQ agents must not query, read, write, synchronize, project, or depend on Trello for project execution unless the Owner explicitly reverses this decision in a later instruction.
- 2026-09-03: Any open or historical branch/PR containing Trello integration or Trello-specific projection is legacy/stale for integration purposes and must not be merged until those Trello dependencies are removed and the resulting exact head passes applicable gates.
- 2026-09-03: GitHub Issues/PR/CI/evidence and canonical TigerIQ runtime/company state remain the applicable operational sources for engineering/project work.

## Repository governance decisions
- 2026-08-29: General repository governance documents use role names instead of personal identities and omit third-party names or private relationship details unless strictly required by an approved business process.
- 2026-08-29: PR #11 may describe verified off-MAIN runtime evidence, but must distinguish the primary stacked path from the separate alternative Phase 0 branch and must not imply MAIN or Production integration.
- 2026-08-29: Independent review Issue #12 passed corrected PR #11 head `f34b8c672112eb38b5d7b0bb04c3af06609759d3`; merge still requires a separate Judge/release decision.
- 2026-08-29: First Judge evaluation at head `627f2b8999e6fbe94ff4cecf9110d7d91dd2d6c7` returned FAIL because review evidence was not yet recorded on Issue #12, Source Index precedence was inconsistent, and CURRENT_STATE omitted PR #13–#18. Merge remains blocked pending fixes and re-judgment.

## Baseline date
2026-09-03
