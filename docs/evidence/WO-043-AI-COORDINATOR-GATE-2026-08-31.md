# WO-043 — AI Coordinator Gate Evidence — updated 2026-09-01

## Scope
Evidence for AI Coordinator implementation only. No App/Android, Web Control, PC01 runtime ownership, MAIN or Production release.

## Source state audited
- Existing provider mesh supports multiple provider/model identities and failure classification.
- Existing actor separation was not enough to prove concrete provider/model independence.
- WO-043 previously required a third distinct Judge only for coding/high-risk work.
- WO-043 default profiles previously included generic OpenAI/Anthropic and generic Gemini routes that could not be assumed billing-safe.
- Current Owner instruction requires universal `Executor -> different Reviewer -> third distinct Judge`, zero-cost/local preference, bounded retry, provider failover and no billing activation.

## Coordinator implementation evidence
Branch: `wo043/ai-coordinator`
PR: #111

Changed capability:
1. `packages/ai-coordinator/src/index.ts`
   - task/risk/cost-aware selection;
   - bounded provider fallback;
   - Executor -> Reviewer -> Judge state machine;
   - universal three-way concrete provider/model identity separation;
   - Judge always excludes both prior identities;
   - atomic persistent checkpoints;
   - redacted evidence with SHA-256 output digest;
   - zero-cost-safe defaults limited to Ollama local and `openrouter/free`;
   - generic OpenAI/Anthropic/Gemini routes require explicit non-default configuration and are not auto-selected.
2. `tests/ai-coordinator.test.ts`
   - low-cost routing;
   - provider failover;
   - bounded attempts;
   - universal three-way independence;
   - fail-closed behavior when a third identity is unavailable;
   - fail-closed zero-cost defaults instead of paid/unproven auto-fallback;
   - restart recovery;
   - evidence privacy.

## 2026-09-01 owning-defect corrections
### Three-way independence
Prior repository PASS at `1f8261c59b6406a471226a762a3b724d5dad93dd` became stale because lower-risk work could reuse Reviewer as Judge. Remediation makes separation universal.

### Billing-safe defaults
A later audit found default Coordinator profiles still contained generic API-capable providers. Remediation implementation/test head is `02e0524debd5167fd7e611729d70e266a7f393b1`.

Checks observed at that head during documentation synchronization:
- Queue Hygiene `33533312758` — PASS.
- Vercel Online Verify `33533312736` — PASS.
- CI `33533312748` — running at synchronization time.

Because documentation commits follow that head, the final exact documentation head must be checked again and is the only automated gate state that matters for final readiness.

## Billing/security truth
- AICoordinator default routing cannot auto-select OpenAI, Anthropic or generic Gemini.
- Default OpenRouter model is exactly `openrouter/free`.
- Only Ollama local and OpenRouter-free are default candidates; if that cannot satisfy three independent identities, orchestration blocks.
- Billing-safe Gemini CLI / Claude subscription routes are governed by #133/#134 and require explicit validated runtime injection.
- No API key/token/credential is committed by WO-043.
- Exported evidence excludes raw prompt/model output/provider exception text and uses SHA-256 stage digests.
- Raw stage output may exist only in the private checkpoint required for recovery.

## Cross-stream boundary
- WO-043 does not own PC01 runtime or live provider tests.
- PC01 runtime/security remains with #114/#116.
- Zero-cost live provider policy/probe is tracked by #133/#134.
- PR #127 must be refreshed after the final WO-043 head.
- PR #131 contains Android v0.7 integration and remains outside this stream.

## Independence truth boundary
Repository tests require three distinct concrete provider/model identities for Executor, Reviewer and Judge. This is engineering evidence only; it does not prove three live providers are configured on PC01.

## Independent review boundary
All earlier review submissions are stale for the latest exact head. A genuinely separate reviewer must review the final head. Same-author/self-review must not be represented as independent evidence.

## Release truth boundary
PR #111 remains unmerged. MAIN/Production was not changed. Final readiness requires exact-head automated PASS plus genuine independent review; release still requires Owner authorization.
