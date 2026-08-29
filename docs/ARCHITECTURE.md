# Architecture

## Purpose
TigerIQ AI Lab is a control plane that governs replaceable AI workers. It owns orchestration, permissions, evidence, gates, auditability, and release eligibility.

## V1 components
- Dashboard/API
- Work Order Engine
- Agent Orchestrator
- Model Router
- Architect/Coding/Reviewer/QA/Judge roles
- Evidence Engine
- Gate Engine
- GitHub Adapter
- Sandbox
- Audit Log
- Golden Dataset registry

## Model routing
Primary low-cost path: Gemini API Free -> OpenRouter free models -> Ollama local. OpenAI and Anthropic adapters remain optional. Provider choice must be replaceable without changing workflow semantics.

## Trust boundary
AI output is advisory until backed by deterministic evidence. Tests, commit SHA, command, exit code, logs/artifacts and timestamps are first-class evidence.

## Project #001
TigerIQ Driver is onboarded only through read/audit + isolated branch + PR. Direct production edits are forbidden.

## Phase 1 executable slice

`packages/control-plane` is the lifecycle authority around the Phase 0 contracts. It currently uses in-memory state so authorization and evidence invariants can be proven without infrastructure. Each accepted mutation appends an audit event; evidence receives a SHA-256 digest; only a distinct reviewer or judge can record a final passing `DONE` decision.

This is not yet a network or Production boundary. Authentication, durable event storage, optimistic concurrency, schema validation at ingress, and recovery remain required before external clients can rely on it.

## Phase 2 persistence slice

`packages/event-store` provides a single-node durable journal. JSONL entries form one global SHA-256 chain while `streamId` and expected version provide per-Work-Order optimistic concurrency. An exclusive lock serializes writers; every read verifies sequence, previous hash, and content hash before returning events. This establishes recovery and tamper detection, but it is not authorization to use the filesystem store in Production.
