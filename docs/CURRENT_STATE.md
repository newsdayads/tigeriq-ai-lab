# Current State

Date: 2026-08-30

TigerIQ AI Lab is operating as an evidence-gated Company OS. Production Web Control is now online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Verified foundation

Phases 0–9 are implemented on stacked branches with independent GitHub Actions evidence. The stack provides governance/contracts, Work Orders and evidence, lifecycle authorization, durable hash-chained journal/recovery, authenticated HTTP control plane, durable idempotency, runtime guardrails, overload/rate limits, and executable provider-neutral Model Router failover.

Phase 9 branch: `phase9/model-router-execution`.
Phase 9 CI evidence: run `33243682544` PASS.

## WO-007 — PC Local AI Execution Worker

Status: HISTORICAL PHYSICAL GATES PASSED; CURRENT REMOTE INGRESS NOT VERIFIED

- Branch `wo007/pc-local-ai-worker`, stacked on verified Phase 9.
- Ollama OpenAI-compatible adapter and bounded provider circuit breaker were implemented.
- Historical physical PC01 E2E with Ollama `qwen2.5-coder:14b`: PASS.
- Historical simulated cloud outage routed to `ollama/qwen2.5-coder:14b` and returned `TIGERIQ_WO007_LOCAL_FALLBACK_OK`.
- Historical watchdog recovery and `[100%] TIGERIQ PC01 AUTO MODE READY` evidence exists.
- Current remote control evidence supersedes assumptions: PC01 queue ingress is presently not verified as operational and Web Control reports PC01 offline until fresh claim/result evidence exists.

## WO-012 — TigerIQ AI Web Control Online

Status: PRODUCTION ONLINE; READ/CHAT PATH PASS; WRITE PATH WAITING ONE-TIME GITHUB AUTHORIZATION

- Repository: `newsdayads/tigeriq-ai-lab`.
- Vercel project: `tigeriq-ai-lab`.
- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- Production UI: Vietnamese, mobile-first, chat-first, branded `TigerIQ AI`.
- Production `/api/control` public status: HTTP 200.
- Verified live snapshot on 2026-08-30: Vercel `online`, GitHub `online`, PC01 `offline`, OpenClaw `unknown`, Ollama `unknown`.
- Queue currently exposes PC01 control-plane issues #57 and #58.
- Informational chat and status do not require secrets.
- Web Control write operations support a browser-scoped fine-grained GitHub token limited to `tigeriq-ai-lab` Issues read/write; token is not persisted to repository or Vercel.
- One-time user GitHub authorization remains required before a Web Control-created Work Order can be runtime-verified.
- Tiger IQ Driver repository/project was not modified or linked.

## PC01 control plane

Current state: BLOCKED BEFORE RELIABLE REMOTE EXECUTION.

- Worker V2 bootstrap previously passed with GitHub CLI/repository access preflight.
- Scheduled Task was running, but deterministic GitHub canary #58 was not claimed.
- Current Web Control therefore correctly reports PC01 `offline`.
- OpenClaw and Ollama remain `unknown` until fresh runtime evidence exists.
- No further PC-local PowerShell interaction is required for the current Web Control rollout; PC01 remediation is deferred to a separate execution-channel recovery step.

## Next gate

Complete one-time GitHub authorization in the TigerIQ AI Web Control browser and verify:

Web chat → exactly one GitHub Work Order → queue refresh → evidence visible.

After that, resume PC01 execution-channel recovery independently so a Web Control-created deterministic command can produce claim/result evidence without manual PC operation.
