# AI Provider Adapters V1

Date verified: 2026-09-04
Status: REPOSITORY IMPLEMENTED — REAL CREDENTIAL/QUOTA E2E PENDING

## Architecture rule
All execution goes through `packages/model-router`. AI Gateway ranks provider/model candidates by capability/health/quota/cost; the canonical ModelRouter performs adapter execution, fallback and circuit breaking. There is no second fallback engine.

Credentials are resolved only at invocation time from server-side references/environment and are never serialized into provider/model registry files, frontend state, evidence, GitHub or Vercel.

## Provider contracts verified from official documentation

- OpenAI: Responses API, `https://api.openai.com/v1/responses`; official server SDK examples use `client.responses.create({ model, input })`. API keys are intended to be stored server-side/environment.
- Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`; authentication via `x-goog-api-key` header.
- Anthropic: Messages API, `POST https://api.anthropic.com/v1/messages`; `x-api-key`, `anthropic-version`, `model`, `max_tokens`, and messages.
- xAI: OpenAI-compatible Inference API; base `https://api.x.ai`, bearer authentication; current guidance supports the Responses endpoint `/v1/responses`.
- DeepSeek: OpenAI-compatible base `https://api.deepseek.com`; current official documentation exposes Responses API at `/responses` and current V4 model family without requiring TigerIQ to hard-code a model name.
- OpenRouter: OpenAI-compatible base `https://openrouter.ai/api/v1`; Responses endpoint supported in addition to chat completions.
- Ollama: retains the existing local OpenAI-compatible adapter at PC01 localhost; no external credential.

## Implementation
`packages/model-router/src/http-adapters.ts`

Factories:
- Responses-compatible HTTP adapter for OpenAI/xAI/DeepSeek/OpenRouter.
- Gemini `generateContent` adapter.
- Anthropic Messages adapter.
- environment secret resolver.
- official endpoint mapping with no hard-coded model selection.

## Safety behavior
- Missing credentials fail before any network request.
- Provider HTTP failure records status only, not upstream response body.
- Credentials are headers only and never included in JSON request bodies.
- Real providers remain disabled in `config/ai/providers.template.json` until Owner supplies credentials and explicitly enables them.
- Cost Guard/authorization remains upstream of paid dispatch.

## Remaining physical/API acceptance
For each provider: Owner supplies credential → connectivity test → model inventory/selected model validation → quota/rate-limit observation → cost policy classification → one safe request → evidence → enable in workforce pool. No provider is marked healthy merely because an adapter exists.
