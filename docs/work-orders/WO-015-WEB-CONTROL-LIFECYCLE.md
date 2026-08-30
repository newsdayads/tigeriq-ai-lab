# WO-015 — Web Control lifecycle + mobile operator hardening

Status: IMPLEMENTING
Date: 2026-08-30

## Goal
Make TigerIQ AI useful as the owner's operational control surface even while conversational GPT is blocked by the Vercel AI Gateway billing gate.

## Scope
1. Work Order lifecycle tracking from GitHub evidence/comments: queued -> claimed -> done/failed/closed.
2. Read-only status lookup by issue number with bounded comment parsing and no prompt/secret leakage.
3. Mobile chat auto-refresh for recently-created/tracked Work Orders, surfaced as concise Vietnamese progress messages.
4. Preserve deterministic dedupe/idempotency from WO-014.
5. PWA installability for iPhone/Android without changing the existing production domain.
6. No PC01/OpenClaw/Ollama mutation; no Tiger IQ Driver changes; no AI Gateway/billing retry.

## Gates
- Static API tests for lifecycle classification and redaction.
- UI verification for auto-refresh and install metadata.
- Existing repository CI PASS.
- Vercel Preview READY.
- Production only after no-regression verification.
