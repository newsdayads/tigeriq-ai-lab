# WO-019 — Provider Mesh v2 on current MAIN

Priority: P1
Status: IMPLEMENTING
Date: 2026-08-30

## Problem
Draft PR #21 / WO-009 implemented a useful cloud-first provider mesh, but its head diverged from current MAIN and contains six commits not safely integrated into the current Production architecture. Merging the stale stacked PR directly would reintroduce obsolete state/docs and an older OpenAI Chat Completions transport.

## Goal
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
- Gemini: `models.generateContent` remains supported for single-turn content generation; the newer Interactions API exists but is not required for this bounded provider adapter.
- Ollama: existing loopback OpenAI-compatible `/v1/chat/completions` adapter retained.

## Safety
- API keys are options/environment only: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`.
- Model IDs are options/environment only: `TIGERIQ_OPENAI_MODEL`, `TIGERIQ_ANTHROPIC_MODEL`, `TIGERIQ_GEMINI_MODEL`, `TIGERIQ_OLLAMA_MODEL`.
- Routing evidence records provider/failure classification only; no prompt, response body, or credential is written into routing attempts.
- Caller cancellation is fail-closed and must not silently fail over to another provider.
- No live paid-provider activation is part of this Work Order.
- No PC01/OpenClaw mutation and no Tiger IQ Driver mutation.

## Gates
- Typecheck, unit tests, Playwright smoke and build PASS on exact head.
- Provider-mesh tests verify route order and native response parsing.
- OpenAI test verifies Responses API transport and header-only bearer credential placement.
- Quota/outage/configuration failures are classified and bounded by circuit suppression.
- Missing cloud credentials fall through safely to local Ollama when configured.
- Caller cancellation never causes silent fallback.
- Final PR must be based directly on current MAIN.
- Draft PR #21 may be closed as superseded only after this replacement is exact-head verified.

## Runtime status
Engineering tests use mocked provider transports only. No real OpenAI/Anthropic/Gemini call is claimed until credentials/model configuration are separately authorized and supplied outside source control.
