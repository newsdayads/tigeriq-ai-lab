# Current State

Date: 2026-08-30

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production baseline

- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- Latest completed remote Work Order: WO-024 — TigerIQ Distributed AI Workforce remote core.
- MAIN merge for WO-024: `295b0b17add37289104c1dc64739ee2694cb8443`.
- Production deployment `dpl_9KBTs1QwkGqEQJuPvTES6eMDtxfv`: READY and aligned to that merge SHA.
- Canonical Production `/api/control`: HTTP 200 after deployment; Vercel/GitHub remain online and existing Web Control behavior is preserved.
- Canonical PC01 execution queue remains exactly issues #57 and #58. No duplicate canary was created.
- PC01 remains outside the completed WO-024 remote-core claim; no PC01/OpenClaw/Ollama runtime recovery is claimed.

## Company operating direction — P0

TigerIQ is now being developed as a continuous distributed AI company rather than a single assistant that waits for Owner commands.

Target operating model:

Owner -> Chief of Staff -> Department Heads -> Team Leads -> multiple AI/device employees -> Independent Reviewer -> Judge/Gate -> Evidence -> Chief -> Owner.

The workforce is expected to operate continuously: audit real state -> select highest-value safe work -> execute -> review/judge -> record evidence/state -> take the next work without waiting for another Owner message. The Owner intervenes to change priority, set limits, authorize gated actions, or stop.

## WO-024 — Distributed AI Workforce remote core

Status: DONE for remote software core; real-device phase not yet claimed.

Verified in MAIN:
- company/department/team hierarchy;
- Workforce Registry for employee identity, role, node, provider/model capability, health, availability, concurrency and outcome metrics;
- Worker Node Registry and heartbeat contract;
- Task Packet, Result and Evidence contracts plus JSON schemas;
- capability-aware scheduling, bounded retry/reassignment and concurrency;
- canonical idempotency even when duplicate requests use different task IDs;
- durable state-store boundary, checkpoints, restart restore and safe recovery of in-flight work;
- independent Reviewer/Judge employee exclusion;
- provider/model diversity preference with same-provider independent fallback to prevent deadlock;
- replaceable Android/API/local/browser/tool/simulator worker adapters;
- simulator proof of two primary employees running concurrently -> independent Reviewer -> independent Judge;
- read-only Workforce status projection including node/employee/task counts and utilization;
- secure worker-node pairing primitive with short-lived one-time challenge, proof-verification boundary, scoped revocable credentials and token-hash-only storage;
- Android Worker MVP execution contract and real-device acceptance criteria.

Exact final PR evidence is recorded in `docs/work-orders/WO-024-DISTRIBUTED-AI-WORKFORCE.md`.

## Existing remote capability retained

- deterministic Work Order fingerprinting and duplicate prevention;
- lifecycle/status evidence and retry-safe ordering;
- explicit dispatch fallback when conversational AI is unavailable;
- evidence-first Work Board;
- mobile/PWA Web Control;
- Provider Mesh v2 engineering path: OpenAI -> Anthropic -> Gemini -> PC01/Ollama, with bounded failure classification and credential-safe evidence;
- governance reconciliation and stale-metadata cleanup.

## External/deferred activation boundaries

- Conversational Chief inference through the WO-013 Vercel AI Gateway path still has the previously observed Vercel billing/card prerequisite. Do not idle on this blocker when other safe work exists.
- Live OpenAI/Anthropic/Gemini Provider Mesh calls require authorized runtime credentials/model configuration and any applicable financial authorization. Engineering readiness does not imply live provider activation.
- No physical Android Worker execution is claimed yet. Real-device activation requires at least one-time install/pairing/Accessibility/login actions on the selected phones.
- Consumer AI app automation must remain provider-specific and enabled only where technically/account-policy appropriate.
- A production durable Workforce backend is not yet configured; current persistence contract/restart behavior is verified in tests, not claimed as live 24/7 phone state.

## Active next priority — Workforce Phase 1

Continue autonomously without waiting for Owner messages:
1. choose/implement the lowest-cost production-safe durable Workforce backend and wire it to Control Plane APIs;
2. expose a mobile Workforce Board for employees/nodes/tasks/health/utilization;
3. create a buildable TigerIQ Worker Android MVP with secure pairing, heartbeat, task inbox, watchdog and result/evidence publishing;
4. create Farm Gateway adapters for ADB/Appium/UiAutomator2/device inventory and legacy-phone fallback;
5. prepare the two-phone real-device acceptance package so the only remaining Owner action is one bundled install/permission/login step;
6. after two-phone PASS, scale-test 5/10/20 workers and add department planner + KPI/performance routing.

If a physical-device, login/2FA, billing, credential or privileged action blocks one path, record the exact blocker and immediately continue other safe backlog work instead of idling.
