# WO-018 — Retry-safe lifecycle ordering

Status: IMPLEMENTING
Date: 2026-08-30

## Problem
The current lifecycle classifier treats any historical FAILED marker as permanently dominant. An open Work Order that later retries successfully can therefore remain incorrectly reported as failed. Marker detection also uses substring matching, so diagnostic prose that merely mentions a marker can create false evidence.

## Goal
Make lifecycle reporting retry-safe and evidence-exact without changing execution behavior or mutating any Work Order.

## Scope
- Parse only exact lifecycle marker lines, not arbitrary marker substrings in prose/code.
- Order lifecycle events by comment timestamp, with stable input-order fallback when timestamps are unavailable.
- For open issues, use the latest real lifecycle marker: claimed / completed / failed.
- Preserve GitHub closed-state semantics: duplicate/not_planned -> cancelled; other closed issue -> completed.
- Preserve historical evidence booleans as “ever observed”, while stage represents current/latest lifecycle state.
- Apply the same classifier to `work-order-status` and WO-017 Work Board through the shared helper.
- No PC01/OpenClaw/Ollama mutation, no Tiger IQ Driver changes, no AI Gateway billing retry.

## Gates
- Tests: claim -> fail -> claim reports claimed.
- Tests: fail -> result reports completed.
- Tests: reverse input order with timestamps still uses chronological latest event.
- Tests: prose/backticked marker mentions do not count as lifecycle evidence.
- Existing Queue Hygiene, CI, Vercel Verify and Preview gates PASS before merge.
