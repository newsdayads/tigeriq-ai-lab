# TIGERIQ — DECISION LOG / BASELINE
Version: 1.0

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

## Repository governance decisions
- 2026-08-29: General repository governance documents use role names instead of personal identities and omit third-party names or private relationship details unless strictly required by an approved business process.
- 2026-08-29: PR #11 may describe verified off-MAIN runtime evidence, but must distinguish the primary stacked path from the separate alternative Phase 0 branch and must not imply MAIN or Production integration.
- 2026-08-29: Independent review Issue #12 passed corrected PR #11 head `f34b8c672112eb38b5d7b0bb04c3af06609759d3`; merge still requires a separate Judge/release decision.
- 2026-08-29: First Judge evaluation at head `627f2b8999e6fbe94ff4cecf9110d7d91dd2d6c7` returned FAIL because review evidence was not yet recorded on Issue #12, Source Index precedence was inconsistent, and CURRENT_STATE omitted PR #13–#18. Merge remains blocked pending fixes and re-judgment.

## 2026-09-03 operational decisions
- PRIMARY Web Control = **PC01 Command Center**, using the existing `apps/dashboard` Command Center implementation.
- SECONDARY/BACKUP = **Vercel**. Vercel is removed from the normal daily execution critical path and remains a fallback surface.
- Vercel Git deployment stays disabled (`git.deploymentEnabled=false`) while the known quota blocker is active. Do not retry/spam deploys or purchase an upgrade automatically.
- PC01 Command Center remote access is private-only via explicit Tailscale/private addressing. Router port forwarding, public Internet exposure, `0.0.0.0` and `::` binds are forbidden.
- Command Center runtime data must be evidence-backed. Missing Work Order/workforce/evidence/telemetry/provider data is shown as unavailable rather than mocked.
- UI operating identity is `Vy — AI Chief of Staff`; user-facing address is `anh Sơn` and direct `Sếp` address is not used.
- These decisions define architecture/behavior but do not constitute physical deployment evidence. WO-059 remains subject to A–K runtime verification before DONE.

## Baseline date
2026-08-29

## Latest decision update
2026-09-03
