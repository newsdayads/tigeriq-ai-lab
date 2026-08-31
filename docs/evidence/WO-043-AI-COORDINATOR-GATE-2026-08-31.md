# WO-043 — AI Coordinator Gate Evidence — 2026-08-31

## Scope
Evidence for AI Coordinator implementation only. No App/Web Control UI modification, no PC01 runtime ownership, and no MAIN/Production release.

## Source state audited
- Existing provider mesh: OpenAI, Anthropic, Gemini, Ollama with failure classification/circuit breaking.
- Existing WorkOrderWorker: distinct actor IDs, but reviewer/judge model identity was not enforced.
- Existing MAIN PC01 worker used one `TIGERIQ_OLLAMA_MODEL` for Executor, Reviewer and Judge; this was identified as a correctness gap, but PC01 implementation belongs to the PC01 stream.

## Coordinator implementation evidence
Branch: `wo043/ai-coordinator`
PR: #111

Changed capability in WO-043 scope:
1. `packages/ai-coordinator/src/index.ts`
   - task/risk/cost-aware selection;
   - bounded provider fallback;
   - Executor -> Reviewer -> Judge state machine;
   - strict model-identity independence for coding/high-risk work;
   - atomic persistent checkpoints;
   - redacted evidence with SHA-256 output digest.
2. `tests/ai-coordinator.test.ts`
   - low-cost routing;
   - provider failover;
   - bounded attempts;
   - strict model independence;
   - restart recovery;
   - evidence privacy.

## Earlier engineering gate
Implementation head `3c6a3b61449a91d213d8d19034a7bf47a6945710` previously passed:
- CI `33356514883`
- Queue Hygiene `33356514902`
- Vercel Online Verify `33356514905`

A later evidence commit produced head `10fc390cc7b8cb75e9f39aa86e974b45b85fd6e6`, which also passed:
- CI `33356650180`
- Queue Hygiene `33356650157`
- Vercel Online Verify `33356650170`

Those runs are historical evidence only and are not the final gate after independent-review remediation.

## Independent review — FAIL
On 2026-08-31 independent audit marked PR #111 FAIL because:
1. WO-043 directly modified `scripts/pc-worker/worker-github-queue.py` while canonical PC01 recovery work existed on `wo011/pc01-remote-exec`.
2. PC01 worker command isolation had separate P0 security blocker #114.
3. Issue #110 had been closed before independent review completed.

## Remediation performed
- Issue #110 reopened.
- PC01 worker restored in PR #111 to the exact MAIN blob `6d25f4d11fd871c129233a9253915aaca3e085f3`, removing WO-043 ownership of that file from the effective PR diff.
- WO-043-specific `tests/pc01-independent-ai-policy.test.ts` removed.
- PC01 runtime/security is handed to issue #114 and draft PR #116 (`wo045/pc01-autonomy-hardening`) built on canonical PC01 recovery branch.
- WO-043 documents the dependency but does not implement or claim PC01 runtime remediation.

## Security/privacy
- No API key/token/credential committed.
- Routing evidence excludes raw prompt and raw model output; stage output is represented by SHA-256 digest in exported evidence.
- Raw stage output may exist only in the private checkpoint required for recovery; JSON file storage is atomic and requests restrictive file mode where supported.
- No paid provider activation is claimed.
- PC01 command-sandbox security is not claimed by WO-043 and remains governed by #114/#116.

## Independence truth boundary
Coordinator tests require different model identities for Executor and Reviewer and three distinct identities for coding/high-risk Executor/Reviewer/Judge workflows. This is policy/engineering evidence, not proof that three live provider identities are currently configured.

## Current gate boundary
The remediation changed PR #111 after the historical passing runs. Therefore fresh exact-head CI plus a new independent review is required before WO-043 can be called DONE or merged.

## Release truth boundary
PR #111 remains unmerged. MAIN/Production was not changed by WO-043.
