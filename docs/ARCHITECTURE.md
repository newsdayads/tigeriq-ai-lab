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

## Phase 3 API boundary

`apps/api` exposes loopback HTTP endpoints for health and Work Order operations. Bearer credentials map to scoped actors; the domain layer still enforces role separation. Mutation requests require JSON, a bounded body, and an actor-scoped idempotency key. This boundary intentionally has no public listener configuration, credential store, TLS, or claim of Production readiness.

## Phase 4 durable API

When configured with a journal path, the API uses `packages/durable-control-plane`. Each command loads and verifies the latest snapshot, applies domain rules in a fresh Control Plane, then appends the result with expected-version concurrency. This makes persisted state authoritative and recoverable across restarts without weakening role or evidence gates.

## Multi-project runtime model — PC01

PC01 is the shared primary compute/control node, not a single-project application server. Multiple TigerIQ-managed projects may use the same physical PC01 while remaining operationally isolated.

Isolation rules:
- one repository and release lifecycle per product/project unless an explicit monorepo decision says otherwise;
- one service identity, process/service name, port allocation and runtime directory per project;
- separate application data/database/schema boundaries; no implicit cross-project writes;
- separate environment/config/secrets per project; credentials are least-privilege and never shared merely for convenience;
- separate Work Order/evidence namespace so one project's state cannot satisfy another project's gates;
- shared infrastructure such as Ollama, PostgreSQL host, Tailscale and telemetry may be reused only behind explicit adapters/connection configuration;
- shared GPU/CPU resources are scheduled with bounded concurrency and project-aware quotas/priority so one workload cannot starve the control plane;
- every project must support independent stop/start/update/rollback without requiring unrelated projects to restart.

Hosting strategy:
- PC01/local-first runtime is the preferred primary path for actively developed TigerIQ services when safe private access is sufficient;
- Vercel is optional secondary/backup hosting for web surfaces that materially need Internet reach; automatic Git deployments remain disabled;
- GitHub remains the repository/CI/evidence coordination layer and must not be treated as runtime proof;
- Work mode, Vercel or any single AI provider must not be a hard dependency of the orchestration contract.

Project onboarding minimum:
1. register project identity, repository and owner-approved scope;
2. allocate runtime/service/data boundaries;
3. define build/test/review/release gates;
4. define PC01 resource budget and required shared services;
5. define private access/exposure policy;
6. prove isolated start/stop, state persistence and rollback before Production eligibility.
