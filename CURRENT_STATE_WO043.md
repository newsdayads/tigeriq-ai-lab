# CURRENT STATE — WO-043 AI COORDINATOR

Date: 2026-09-01
Status: THREE-WAY INDEPENDENCE + ZERO-COST SAFE DEFAULTS REMEDIATED — FINAL EXACT-HEAD REGATE REQUIRED
Branch: `wo043/ai-coordinator`
PR: #111
Issue: #110

## Working capability in WO-043 scope
- Work item carries kind/risk/acceptance criteria.
- Coordinator chooses the lowest-cost configured model that meets the required quality profile.
- Provider failures fall through to another eligible model with a bounded attempt count.
- Completed stages are checkpointed so restart resumes from persisted progress instead of repeating completed execution.
- Every attempt records role, provider/model identity, outcome and failure class.
- Exported evidence omits raw prompt/output and uses an output SHA-256 digest.
- Reviewer cannot use Executor identity.
- Judge cannot use Executor or Reviewer identity.
- Every coordinated work item requires three distinct Executor/Reviewer/Judge provider-model identities and fails closed if a third identity is unavailable.

## 2026-09-01 corrections
### Universal three-way independence
The prior implementation required a third distinct Judge only for coding/high-risk work. Current Owner instruction requires `AI làm -> AI khác kiểm tra -> AI thứ ba phán quyết` for every coordinated work item.

Remediation:
- Judge always excludes both prior concrete provider/model identities.
- Low-risk/general work with only two eligible identities blocks rather than reusing Reviewer as Judge.
- Regression coverage proves three-way separation, restart recovery and evidence privacy.

### Zero-cost safe defaults
Audit found the AI Coordinator default profile still included generic OpenAI/Anthropic API backends and a generic Gemini route, which could not be assumed billing-safe.

Remediation:
- Default Coordinator profiles are now only Ollama local and `openrouter/free`.
- Generic OpenAI, Anthropic and Gemini routes are not selected by default.
- If only those two safe default identities are available, the third Judge fails closed rather than auto-selecting a paid/unproven API route.
- Billing-safe Gemini CLI / Claude subscription routes must be explicitly injected only after the zero-cost policy gate in #133/#134 proves the route.

Implementation/test head `02e0524debd5167fd7e611729d70e266a7f393b1`:
- Queue Hygiene `33533312758` — PASS.
- Vercel Online Verify `33533312736` — PASS.
- CI `33533312748` — running at documentation synchronization time; final documentation head must be gated again regardless.

## Cross-stream boundary retained
- WO-043 does not own PC01 runtime.
- PC01 recovery/security remains delegated to #114/#116.
- Runtime zero-cost provider policy/probe remains governed by #133/#134.
- PR #127 must be refreshed onto the final WO-043 head after this remediation.
- PR #131 contains Android v0.7 integration and remains outside this stream.

## Not claimed / not changed
- No App/Android change.
- No Web Control change.
- No PC01 runtime implementation or live provider result.
- No MAIN/Production merge or deployment.
- No paid-provider activation, purchase or payment method.
- No new secret/token in source control.
- No genuine independent exact-head review claim after the 2026-09-01 changes.

## Current next gate
1. Fresh exact-head CI, Queue Hygiene and Vercel Verify after documentation synchronization.
2. Refresh #127 onto this final coordinator head and re-run its exact-head gate.
3. Genuinely independent exact-head review; same-author/self-review is not accepted as independent evidence.
4. Merge/release remains blocked without normal Owner authorization.
