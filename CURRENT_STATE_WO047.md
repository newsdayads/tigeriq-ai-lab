# CURRENT STATE — WO-047 OPTIONAL INFERENCE GATEWAY ADAPTER

Date: 2026-09-02  
Status: DISTRIBUTED AI RUNTIME V1 INTEGRATED — MERGE HEAD CI PASS — FINAL DOC HEAD REGATE / INDEPENDENT REVIEW PENDING  
Branch: `wo047/api-first-inference-gateway`  
PR: #127  
Issue: #125

## V1 role
PR #127 is an **optional `pc01-server` inference adapter**. It is no longer interpreted as the mandatory provider-call path for every AI Employee.

TigerIQ V1 supports:
- `pc01-local` — local model/runtime on PC01;
- `pc01-server` — explicitly selected server-side provider call through an adapter such as this Gateway;
- `employee-device` — phone/device keeps its own provider authentication, calls its provider itself and returns standardized result/evidence to PC01.

The Coordinator does not require possession of provider credentials.

## Gateway capability retained for `pc01-server`
- TigerIQ Employee Identity remains independent from provider/model backend identity.
- Provider credentials used by this explicit server adapter remain server-side and are not returned to clients.
- Short-lived authenticated sessions protect Gateway calls.
- Provider quota/429, outage, timeout, auth/configuration and invalid responses are classified.
- Health/cooldown and request-unit budgets affect selection.
- Route retries are bounded to maximum 3.
- Reviewer/Judge backend identity exclusions fail closed when an independent backend is unavailable.
- Mock-device Gateway tests cover session -> inference -> sanitized evidence and idempotent replay.

## Device-direct boundary
For `employee-device` jobs:
- PC01/Server transports JOB + rendered Prompt only;
- device provider credential remains on the device;
- device calls its own provider directly;
- standardized `TIGERIQ_JOB_EXECUTION_V1` result/evidence returns to PC01;
- #127 is bypassed as the provider-call path.

No provider secret exists in the distributed execution request/result contract.

## 2026-09-02 final Coordinator/Prompt Architect refresh
Current #111 exact head: `b989a2599ae17ef50ee397a7bae2dd174701f340`.

#127 was refreshed using union tree + two-parent merge `264dfb6147149edf58966ce33a5525a4aec200ba`:
- first parent: prior #127 head `50bf1fbc9024c2c82331358f1aefec298d8990e6`;
- second parent: #111 final head `b989a2599ae17ef50ee397a7bae2dd174701f340`;
- branch ref updated with `force=false`.

Compare against #111 proves `behind_by=0` and the effective #127 layer adds only 12 Gateway-owned files, including the optional-adapter addendum. AI Runtime V1 / Prompt Architect files from #111 are preserved.

Automated evidence at merge head `264dfb6...`:
- CI `33584355276`: PASS.

This CURRENT_STATE synchronization creates a new exact head, so CI must run once more before final repository automated PASS is claimed.

## Prompt Architect / JOB-001 integration
Canonical distributed contract lives in the #111 base:
- `packages/ai-runtime-v1/src/index.ts`;
- `schemas/ai-execution-v1.schema.json`;
- `docs/contracts/AI_COORDINATION_PROMPT_ARCHITECT_V1.md`.

The expected JOB-001 path may use a phone directly:
`PC01 Coordinator -> Prompt Architect -> employee-device -> device-owned provider -> standardized result -> independent Reviewer -> independent Judge`.

Gateway remains available only when routing intentionally selects a `pc01-server` endpoint.

## Zero-cost / runtime boundary
- Billing-safe execution policy belongs to #133/#134.
- No live Gemini/Claude/OpenRouter/Ollama credential/auth/quota result is claimed here.
- No physical PC01/Tailscale/phone/JOB-001 E2E result is claimed.
- Provider budget/health/idempotency remain process-local in this Gateway implementation.

## Not changed
- No Android implementation.
- No Web Control.
- No PC01 runtime implementation.
- No MAIN/Production.
- No payment method/paid service.

## Remaining gates
1. Final exact documentation head CI PASS.
2. Genuine independent exact-head review; same-author/self-review is invalid.
3. Physical JOB-001 runtime acceptance remains with the owning PC01/device streams.
