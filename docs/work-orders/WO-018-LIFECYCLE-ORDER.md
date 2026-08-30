# WO-018 — Retry-safe lifecycle ordering

Status: DONE
Date: 2026-08-30

## Problem
The previous lifecycle classifier treated any historical FAILED marker as permanently dominant. An open Work Order that later retried successfully could therefore remain incorrectly reported as failed. Marker detection also used substring matching, so diagnostic prose that merely mentioned a marker could create false evidence.

## Delivered
- Parse lifecycle markers only when the marker is the exact first token of a trimmed comment line.
- Order lifecycle events by GitHub comment timestamp, with stable input-order fallback when timestamps are unavailable.
- For open issues, use the latest real lifecycle marker: claimed / completed / failed.
- Preserve GitHub closed-state semantics: duplicate/not_planned -> cancelled; other closed issue -> completed.
- Preserve historical evidence booleans as “ever observed”, while stage represents current/latest lifecycle state.
- Apply the same classifier to `work-order-status`, Work Board and PC01 status.
- No PC01/OpenClaw/Ollama mutation, no Tiger IQ Driver changes, no AI Gateway billing retry.

## Verification
- Tests: claim -> fail -> claim reports claimed.
- Tests: fail -> result reports completed.
- Tests: reverse input order with timestamps still uses chronological latest event.
- Tests: prose/backticked marker mentions do not count as lifecycle evidence.
- Apply run `33312826563`: PASS for syntax, retry-order tests, Work Board invariants, UI and build.
- Final exact head `f53a1d82a6bd570619b0ef3386aebaf951664fd9`; one-time patcher/apply workflow removed from final diff.
- Exact-head Vercel Preview `dpl_FCQrP9EUu5ZSP6WLRB7WVPqoKT7P`: READY.
- PR #74 exact-head Queue Hygiene `33312960795`: PASS.
- PR #74 exact-head Vercel Verify `33312960796`: PASS.
- PR #74 exact-head CI `33312960802`: PASS.
- PR #74 merged to MAIN as `ba059c59dc13c91a4c7f2abc26b2a1ad8afd164b`.
- Production deployment `dpl_5cjyVfkGJ2wPLsBLCXhGF9nU9Yuj`: READY.
- Production `/api/control`: HTTP 200 with existing deterministic capabilities intact; queue remains canonical #57/#58.
- Canonical canary #58 still has no lifecycle comments; PC01 therefore remains offline. No recovery is claimed.
