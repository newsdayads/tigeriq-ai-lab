# CURRENT STATE — WO-043 AI COORDINATOR + PROMPT ARCHITECT

Date: 2026-09-02
Status: AI RUNTIME V1 + PROMPT ARCHITECT IMPLEMENTED — IMPLEMENTATION HEAD AUTOMATED PASS — FINAL DOC HEAD REGATE / INDEPENDENT REVIEW PENDING
Branch: `wo043/ai-coordinator`
PR: #111
Issue: #110

## V1 architecture now implemented
- Coordinator selects an execution endpoint; it does not imply where provider credentials live.
- Supported execution locations: `pc01-local`, `pc01-server`, `employee-device`.
- Device execution may keep provider authentication on the device and return only standardized result/evidence to PC01.
- `AIExecutionAdapterV1` has no provider-secret field.
- `TIGERIQ_JOB_EXECUTION_V1` request/result contract carries JOB-ID, PROMPT-ID/version, employee/endpoint, provider/model result metadata, timestamps, attempts/failover/errors/evidence and `credentialExposure=false`.

## Routing
`AIRouterV1` filters/ranks by:
- work kind and capabilities;
- risk-dependent capability floor;
- quota state;
- stability;
- speed;
- historical quality;
- cost rank;
- local execution preference;
- billing safety;
- concrete provider/model identity exclusions for independent stages.

`unknown`/`paid` billing and exhausted quota fail closed under zero-cost mode.

## Independent chain
- Existing Coordinator keeps Executor -> independent Reviewer -> independent Judge.
- New V1 router can select each stage while excluding prior concrete `provider/model` identities.
- Different endpoints using the same provider/model do not count as independent backend identities.
- Risk changes capability threshold/model strength, not the independence rule.

## AI KIẾN TRÚC SƯ PROMPT
Implemented in `packages/ai-runtime-v1/src/index.ts`:
- input: goal + context + employee + target provider/model/endpoint + work kind/risk + acceptance criteria + completion standard;
- output: `PROMPT-ID`, version, template ID/version, rendered specialized Prompt, target metadata, PASS/FAIL status, repair count and history;
- model-oriented templates for Gemini, Claude, OpenRouter, Ollama and generic fallback;
- template selection improves from real independent PASS/FAIL + latency history;
- bounded repair loop keeps the same PROMPT-ID and increments version/repair count;
- Prompt Architect is forbidden from Reviewer/Judge self-evaluation of its own Prompt outcome.

## JOB-001 contract candidate
- Human-readable contract: `docs/contracts/AI_COORDINATION_PROMPT_ARCHITECT_V1.md`.
- Machine schema: `schemas/ai-execution-v1.schema.json`.
- Unit coverage: `tests/ai-runtime-v1.test.ts`.
- PR #127 Inference Gateway is now treated as an optional `pc01-server` execution adapter; device-direct execution does not require that provider-call path.

## Automated evidence
Implementation/test head `92b9df06117f0e4576a66d63e57a78cc8fad5404`:
- CI `33584061099`: PASS.
- Queue Hygiene `33584061058`: PASS.
- Vercel Online Verify `33584061082`: PASS.

The first implementation head `37a7fed...` correctly failed one unit assertion because local-first routing ranked PC01-local before the phone. Test expectation was corrected without changing routing logic.

## Related zero-cost policy
PR #134 exact head `4a3a1af0a6d2c86df8b0419eae3c041f91a3ad97` now explicitly states:
- Coordinator does not require provider credentials;
- server provider call is not mandatory;
- employee-device owns its own provider credential;
- provider secrets are not evidence.
Its CI/Queue/Probe Guard/Vercel gates all PASS.

## Cross-stream boundary
- No Android implementation changed.
- No Web Control changed.
- No PC01 runtime implementation or physical provider call is claimed.
- PR #127 must be refreshed onto the final #111 head after doc synchronization.
- No MAIN/Production and no paid service/payment method.

## Truth / remaining gates
NOT DONE.
1. Final doc head requires fresh exact-head CI/Queue/Vercel.
2. PR #127 must be refreshed onto that final head and re-gated.
3. Genuine independent exact-head review is required; same-author/self-review is invalid.
4. Physical JOB-001 PC01 -> Tailscale -> phone -> provider -> PC01 -> Reviewer remains a runtime/device acceptance gate and is not claimed by repository tests.
