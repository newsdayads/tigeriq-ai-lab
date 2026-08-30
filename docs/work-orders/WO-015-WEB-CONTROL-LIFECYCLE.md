# WO-015 — Web Control lifecycle + mobile operator hardening

Status: DONE — CI PASS + PREVIEW READY + PRODUCTION READY + RUNTIME PASS
Date: 2026-08-30

## Goal
Make TigerIQ AI useful as the owner's operational control surface even while conversational GPT is blocked by the Vercel AI Gateway billing gate.

## Delivered
1. Work Order lifecycle tracking from GitHub issue state/evidence: `queued` → `claimed` → `completed` / `failed` / `cancelled`.
2. Read-only `work-order-status` returns bounded state metadata and sanitized evidence booleans only; raw comment bodies are not returned.
3. Mobile chat tracks recently created Work Orders locally and polls lifecycle every 30 seconds, surfacing stage transitions in concise Vietnamese.
4. WO-014 deterministic dedupe/idempotency remains intact.
5. `Kiểm tra PC01` reads canonical canary #58 and does not create additional canary issues.
6. PWA/mobile install metadata added: manifest, standalone mode, theme metadata, mobile title, icon, and network-only service worker to avoid stale control UI caching.
7. No PC01/OpenClaw/Ollama mutation; no Tiger IQ Driver changes; no AI Gateway billing retry.

## Evidence
- Lifecycle verification run `33311306234`: PASS after correcting the CI harness to install repository dependencies.
- Final exact branch head `de44326a8e5ba6528e6f9f9ddea31e11224ba367` gates: CI `33311507558` PASS; Queue Hygiene `33311507578` PASS; Vercel Verify `33311507577` PASS.
- Exact-head Vercel Preview `dpl_3uamS5mzVwHLLy5m54CmSaEWDGWN`: READY.
- PR #67 merged to `main` as `7f3e2bf4f0bfdd5978d94bb08e3abef63570cac6`.
- Production deployment `dpl_3GpKncedLZRwoiGRMm4htgx4rEJZ`: READY.
- Production runtime: `/` HTTP 200; `/api/control` HTTP 200 with `workOrderDedupe=true`, `workOrderStatusTracking=true`, `workOrderLifecycleEvidence=true`; `/manifest.webmanifest` HTTP 200; `/sw.js` HTTP 200; queue remains exactly PC01 #57/#58 and PC01 reports offline from current evidence.

## Deferred external blocker
Conversational GPT inference remains blocked only by the existing Vercel AI Gateway billing/card requirement documented in WO-013. WO-015 does not depend on that gate.
