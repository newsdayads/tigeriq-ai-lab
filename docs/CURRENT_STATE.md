# Current State

Date: 2026-08-30

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production baseline

- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- MAIN includes WO-013 through WO-021, including Chief-of-Staff chat, queue hygiene, lifecycle/PWA, explicit dispatch, evidence-first Work Board, retry-safe lifecycle ordering, Provider Mesh v2, Source-of-Truth reconciliation, and remote governance hygiene.
- Current MAIN merge SHA: `220f29a05300af54f25fec73d35c550534d92449` (PR #76 / WO-021).
- WO-021 exact head `ea60b72a1e5c696794303785e5782909d813f964` passed CI, Queue Hygiene, and Vercel Online Verify; its Vercel Preview was READY before merge.
- Canonical PC01 execution queue remains exactly issues #57 and #58. No duplicate canary was created.
- PC01 remains outside remote-only scope for this state reconciliation; no PC01/OpenClaw/Ollama runtime recovery is claimed.

## Remote-only capability state

DONE and retained in MAIN:
- deterministic Work Order fingerprinting and duplicate prevention;
- lifecycle/status evidence and retry-safe ordering;
- explicit dispatch fallback when conversational AI is unavailable;
- evidence-first Work Board;
- mobile/PWA Web Control;
- Provider Mesh v2 engineering path: OpenAI -> Anthropic -> Gemini -> PC01/Ollama, with bounded failure classification and credential-safe evidence;
- governance reconciliation and stale-metadata cleanup without merging obsolete dependency-chain branches.

## WO-021 — Remote Governance Hygiene

Status: DONE — EXACT-HEAD GATES PASS + PREVIEW READY + MERGED

Evidence:
- Branch: `wo021/remote-governance-hygiene`.
- Exact head: `ea60b72a1e5c696794303785e5782909d813f964`.
- CI run `33314734153`: PASS.
- Queue Hygiene run `33314734106`: PASS.
- Vercel Online Verify run `33314734113`: PASS.
- Vercel Preview reported READY on PR #76.
- PR #76 merged to MAIN as `220f29a05300af54f25fec73d35c550534d92449`.
- Canonical PC01 issues #57/#58 were preserved; no canary, Driver mutation, provider credential action, or Vercel AI Gateway billing/card action occurred.

## External blockers / deferred activation

- Conversational Chief inference through the WO-013 Vercel AI Gateway path still requires the separate Vercel account billing/card prerequisite previously observed. Remote autonomous work must not retry or request that action while the user is driving.
- Live OpenAI/Anthropic/Gemini Provider Mesh calls require authorized runtime credentials/model configuration and any applicable financial authorization. Engineering readiness does not imply live provider activation.
- PC01 issue #57 recovery and canary #58 require the PC01 execution path; remote-only work must preserve them without creating duplicate canaries.

## Next remote-only priority

Continue reducing operator burden and strengthening Work Order/evidence governance from current MAIN. Before any implementation, audit current MAIN/Production and use a dedicated off-MAIN branch with deterministic exact-head gates and Vercel Preview. Do not touch `newsdayads/drivetrack`, PC01 runtime, billing/card actions, secrets, or paid services.
