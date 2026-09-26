# ADR 0010 — Executable model routing

## Decision
Phase 9 turns the existing routing policy contract into an executable, provider-neutral failover router. Provider adapters remain injected at runtime; credentials and provider SDKs are not embedded in the control plane.

## Invariants
- Candidate order is policy-defined and deterministic.
- Missing or failing adapters fail over without changing workflow semantics.
- Empty provider output is a failed attempt.
- Exhaustion fails closed with bounded attempt metadata; prompts, credentials and provider payloads are not copied into attempt evidence.
- No paid provider is activated and no Production exposure is introduced by this phase.

## Consequence
The orchestration layer can execute replaceable AI providers through one contract while preserving the free-first Gemini -> OpenRouter -> Ollama baseline. Concrete network adapters and secret provisioning remain separate gated work.
