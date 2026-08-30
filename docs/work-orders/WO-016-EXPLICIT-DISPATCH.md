# WO-016 — Explicit dispatch fallback + work view

Status: IMPLEMENTING
Date: 2026-08-30

## Goal
Keep TigerIQ AI operational while conversational GPT inference is blocked by the deferred Vercel AI Gateway billing gate.

## Scope
- Add an explicit `Giao việc` action beside normal chat. This bypasses AI intent classification only when the owner deliberately taps that action.
- Reuse existing GitHub authorization, fingerprint dedupe and lifecycle tracking.
- Mark direct dispatch evidence truthfully as owner-explicit, not Chief-classified.
- Add a `Công việc` quick action that shows currently tracked Work Orders/stages without creating new issues.
- Preserve fail-safe normal chat: GPT failure must never silently create a Work Order.
- No PC01/OpenClaw/Ollama mutation, no Tiger IQ Driver changes, no billing retry.

## Gates
- Static explicit-dispatch invariant verification.
- Existing CI + Queue Hygiene + Vercel Verify PASS.
- Vercel Preview READY.
- Production runtime preserves `/api/control` and canonical PC01 queue #57/#58.
