# TigerIQ AI Coordination + Prompt Architect V1

Status: INTEGRATION CANDIDATE — no MAIN/Production  
Owner stream: 04 — Bộ Điều Phối Nhiều AI & Kiến Trúc Sư Prompt  
Target integration: JOB-001

## 1. Architectural invariant

The Coordinator decides **who should do the work**. It does not imply **where credentials live** or **where the provider call runs**.

Supported execution locations:
1. `pc01-local` — local AI runtime on PC01, normally no provider credential.
2. `pc01-server` — an explicitly approved server-side execution adapter; credentials, if any, belong to PC01/runtime and remain outside Coordinator evidence.
3. `employee-device` — an AI Employee phone/device receives the JOB/Prompt and calls its own configured AI API locally on that device. The Server/PC01 does not need that provider credential and does not call the provider on behalf of the phone.

The canonical endpoint identity is `endpointId + employeeId + provider/model + location`. Provider/model is execution metadata, never employee identity or authorization.

## 2. Zero-cost / billing safety

Routing defaults to `zeroCostOnly=true`.
Allowed billing states are only:
- `local-zero-cost`;
- `free-tier-proven`;
- `subscription-proven`.

`unknown` and `paid` fail closed. Quota `exhausted` is ineligible. Quota failure or runtime failure may move to another eligible endpoint, with bounded attempts only.

No payment method, paid fallback, hidden credit continuation, or automatic upgrade is authorized by this contract.

## 3. Routing dimensions

`AIRouterV1` evaluates eligible endpoints using all of the following:
- work kind/capability fit;
- risk-dependent capability floor;
- quota state;
- stability score;
- speed score;
- historical quality score based on real outcomes;
- cost rank;
- local execution bonus;
- role eligibility;
- concrete backend identity exclusions for independent verification.

Paid/unknown billing and exhausted quota are filtered before ranking.

## 4. Independent execution chain

For the current TigerIQ engineering gate:

`Executor -> independent Reviewer -> independent Judge`

Each stage excludes prior concrete `provider/model` identities. A different endpoint running the same provider/model does **not** count as an independent backend identity for this gate.

Risk affects capability threshold and model strength. It does not permit the Prompt Architect to become its own Reviewer/Judge.

## 5. AI KIẾN TRÚC SƯ PROMPT

The Prompt Architect receives:
- Goal;
- Context;
- Target employee and employee role/capabilities;
- Target provider/model/endpoint;
- Work kind and risk;
- Acceptance criteria;
- Completion standard.

It produces a `PromptArtifactV1` containing:
- `PROMPT-ID`;
- prompt `version`;
- `templateId` + template version;
- architect backend identity;
- target employee/endpoint/provider/model;
- acceptance criteria;
- rendered specialized prompt;
- PASS/FAIL status;
- `repairCount`;
- immutable-style history entries.

The same PROMPT-ID is retained across repairs; version increments for every repair.

## 6. Model-specific Prompt Library

The library contains provider-oriented templates for Gemini, Claude, OpenRouter, Ollama plus a generic fallback.

Template choice is not permanently hard-coded. Real independent outcomes update template history:
- PASS/FAIL count;
- latency samples;
- resulting pass-rate evidence.

Future Prompt creation ranks matching templates partly by observed outcome history. This is the approved prompt-improvement loop.

The Prompt Architect does **not** grade its own work. Only outcomes from a distinct Reviewer or Judge backend identity may update prompt history.

## 7. Repair loop

A Prompt may be repaired only after independent `FAIL` feedback with concrete repair information.

Rules:
- bounded `maxRepairs`;
- same PROMPT-ID;
- increment prompt version and repair count;
- retain history;
- inject the independent failure feedback into the next specialized Prompt;
- when repair budget is exhausted, fail closed instead of looping.

## 8. Execution contract

Machine schema: `schemas/ai-execution-v1.schema.json`.

Request fields include:
- JOB-ID;
- PROMPT-ID/version;
- employee/endpoint;
- execution role;
- idempotency key;
- rendered Prompt;
- creation timestamp.

Standard result fields include:
- JOB-ID;
- PROMPT-ID/version;
- employee/endpoint;
- provider/model;
- output;
- start/completion timestamps;
- attempts;
- failover count;
- bounded error codes;
- evidence references/digests;
- `credentialExposure: false`.

There is intentionally no provider secret field in the request/result contract.

## 9. JOB-001 expected flow

`PC01 Coordinator -> choose AI Employee endpoint -> Prompt Architect creates model-specific PROMPT-ID/version -> endpoint receives JOB/Prompt -> endpoint executes locally or calls its own provider -> standardized result returns to PC01 -> independent Reviewer endpoint -> independent Judge endpoint -> evidence/state update`.

For an `employee-device` endpoint, provider authentication remains on that device. PC01 may transport the Prompt/Result over Tailscale but does not need to possess or proxy the provider credential.

## 10. Compatibility with PR #127

PR #127 Inference Gateway becomes an **optional server-side execution adapter**, not a mandatory path for every AI Employee.

Its server-held credential design remains valid only for calls intentionally routed to that server execution endpoint. Device-direct API employees bypass that provider-call path and use the distributed execution contract above.

No Android implementation is changed by this contract.

## 11. Evidence and truth boundaries

Repository tests may prove routing, Prompt lifecycle, dispatch contract, independence and secret-free envelopes. They do not prove:
- physical PC01 availability;
- phone installation/authentication;
- a real Gemini/Claude/OpenRouter/Ollama provider call;
- real quota state;
- Tailscale connectivity;
- JOB-001 physical E2E.

Those require runtime/device evidence from the owning streams.
