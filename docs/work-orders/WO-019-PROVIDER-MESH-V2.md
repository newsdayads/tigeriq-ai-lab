# WO-019 — Provider Mesh v2 on current MAIN

Priority: P1
Status: DONE — ENGINEERING + EXACT-HEAD GATES + PRODUCTION REGRESSION PASS; LIVE CLOUD ACTIVATION NOT CLAIMED
Date: 2026-08-30

## Problem
Draft PR #21 / WO-009 implemented a useful cloud-first provider mesh, but its head diverged from current MAIN and contained six commits that were not safely integrated into the current Production architecture. Merging that stale stacked PR directly would have reintroduced obsolete state/docs and an older OpenAI Chat Completions transport.

## Goal delivered
Port only the still-valid provider-routing capability onto current MAIN, preserve local Ollama fallback, and verify current provider API contracts without activating paid services or committing credentials.

## Route
1. OpenAI cloud
2. Anthropic/Claude cloud
3. Gemini cloud
4. PC01/Ollama local

Provider model IDs remain runtime configuration; no fast-changing model ID is hard-coded.

## Current API contracts verified 2026-08-30
- OpenAI: Responses API `POST /v1/responses`.
- Anthropic: Messages API `POST /v1/messages`.
- Gemini: `models.generateContent` for the bounded single-turn adapter.
- Ollama: existing loopback OpenAI-compatible `/v1/chat/completions` adapter retained.

## Safety
- API keys are options/environment only: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`.
- Model IDs are options/environment only: `TIGERIQ_OPENAI_MODEL`, `TIGERIQ_ANTHROPIC_MODEL`, `TIGERIQ_GEMINI_MODEL`, `TIGERIQ_OLLAMA_MODEL`.
- Routing evidence records provider/failure classification only; no prompt, response body, or credential value is written into routing attempts.
- Caller cancellation is fail-closed and does not silently fail over.
- No live paid-provider activation occurred.
- No PC01/OpenClaw mutation and no Tiger IQ Driver mutation.

## Evidence
- Clean replacement branch: `wo019/provider-mesh-v2`, based directly on MAIN `be04f71fa4390802e63947fb45206ed8a7320603`.
- First PR head exposed one incorrect privacy-test assertion; Typecheck and 56/57 tests passed. The test was corrected to check actual credential-value leakage rather than the generic word `key`.
- Final exact head: `dcd424b737599aa5d1b18f9ee9bdcb5e1af73866`.
- Exact-head Queue Hygiene run `33313506301`: PASS.
- Exact-head CI run `33313506305`: PASS — Typecheck, Unit tests, Playwright smoke and Build all PASS.
- Exact-head Vercel Verify run `33313506309`: PASS.
- Exact-head Preview `dpl_5jKVBo2FvEgMFaALsonju1khQm6F`: READY.
- PR #75 merged as `8307b1d5e2b82ad1b70b668d81f5397a7afffef9`.
- Production deployment `dpl_D2B2s1VtnnZm8ExYw1eFQRfNxprJ`: READY and aligned to merge SHA.
- Canonical Production `/api/control`: HTTP 200 after deployment; Vercel/GitHub online; existing deterministic Web Control capabilities preserved; queue remains exactly #57/#58.
- PC01 still reports `offline`; WO-019 makes no PC01 recovery claim.

## Runtime status
Engineering/provider tests use mocked cloud transports only. No real OpenAI/Anthropic/Gemini provider call is claimed until credentials/model configuration and any financial requirements are separately authorized and supplied outside source control.

## Supersession
PR #21 / WO-009 is replaced by this current-MAIN implementation and may be closed as superseded while preserving its branch and historical evidence.
