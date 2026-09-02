# WO-043 — AI Coordinator + Prompt Architect Gate Evidence

Updated: 2026-09-02

## Scope
AI orchestration/routing/Prompt architecture only. No Android implementation, Web Control, PC01 runtime ownership, MAIN or Production release.

## Source-of-Truth constraints applied
- Free/local first and fail closed on unknown/paid billing.
- Use multiple AI backends with independent review where required.
- Preserve evidence truth; do not claim live device/provider results from repository tests.
- No automatic purchase/payment activation.

## Existing Coordinator behavior retained
- Work kind/risk/capability selection.
- Bounded provider failover/retry.
- Persistent checkpoints/resume.
- Executor -> independent Reviewer -> independent Judge by concrete provider/model identity.
- SHA-256 evidence export without raw prompt/output/provider exception text.

## V1 distributed execution implementation
Files:
- `packages/ai-runtime-v1/src/index.ts`
- `tests/ai-runtime-v1.test.ts`
- `schemas/ai-execution-v1.schema.json`
- `docs/contracts/AI_COORDINATION_PROMPT_ARCHITECT_V1.md`

Proven repository behavior:
1. Coordinator can rank `pc01-local`, `pc01-server`, and `employee-device` endpoints.
2. Routing uses work kind/capability, risk floor, quota, stability, speed, historical quality, cost, local preference and billing safety.
3. Paid/unknown billing and exhausted quota are excluded under zero-cost routing.
4. Reviewer/Judge endpoint selection can exclude prior concrete provider/model identities.
5. Device-owned execution adapter can receive JOB/Prompt and return standardized result/evidence without any provider-secret field in the contract.
6. Result validation requires endpoint/employee/provider/model match and `credentialExposure=false`.

## Prompt Architect implementation
`PromptArchitectV1` proves:
- deterministic `PROMPT-ID` lineage + prompt version;
- template ID/version + model-oriented library;
- goal/context/employee/provider/model/acceptance-aware rendering;
- PASS/FAIL history;
- bounded repair count;
- repair keeps same PROMPT-ID and increments version;
- template choice can improve from independent observed PASS/FAIL + latency history;
- architect backend is forbidden from reviewing/judging its own Prompt result.

## JOB-001 contract
Canonical candidate flow:
`PC01 Coordinator -> route endpoint -> Prompt Architect -> employee execution endpoint -> standardized result -> independent Reviewer -> independent Judge -> evidence/state`.

For `employee-device`, provider authentication stays on that device. Server transport does not require possession of the device provider credential.

## Automated evidence
Implementation/test head: `92b9df06117f0e4576a66d63e57a78cc8fad5404`.
- CI `33584061099`: PASS.
- Queue Hygiene `33584061058`: PASS.
- Vercel Online Verify `33584061082`: PASS.

Initial implementation head `37a7fed7559491195da581b18c94df9bcdf816f0`:
- Typecheck passed.
- Unit run found exactly one assertion mismatch: production ranking correctly preferred `PC01-LOCAL`, while the test expected phone-first.
- Fix changed test expectation only; routing implementation was preserved.

## Related zero-cost policy proof
PR #134 exact head `4a3a1af0a6d2c86df8b0419eae3c041f91a3ad97`:
- CI `33584018878`: PASS.
- Queue Hygiene `33584018863`: PASS.
- WO-048 Multi-AI Probe Guard `33584018893`: PASS.
- Vercel Verify `33584018835`: PASS.

That policy explicitly states Coordinator credential independence, non-mandatory server provider calls, employee-device credential ownership and no provider secrets in evidence.

## PR #127 boundary
#127 remains useful as an optional `pc01-server` inference adapter. Its server-held credential model applies only to work intentionally routed through that endpoint. Device-direct employees bypass that provider-call path.

#127 must be refreshed onto the final #111 head after documentation synchronization before current-stack readiness can be claimed.

## Truth boundary / remaining gates
Repository engineering evidence does **not** prove:
- PC01 is currently online;
- Tailscale route is live;
- phone app is installed/configured;
- real Gemini/Claude/OpenRouter/Ollama auth/quota;
- real JOB-001 physical E2E.

Final #111 documentation head needs fresh automated gates. Genuine independent exact-head review is still required. No MAIN/Production release is authorized.
