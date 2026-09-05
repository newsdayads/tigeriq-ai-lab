# ADR 0012 — PC01 Shared Multi-Project Runtime

Date: 2026-09-03
Status: Proposed — requires independent review/judge before merge

## Context
TigerIQ will operate multiple products/projects. Vercel quota and per-deployment coupling showed that hosted SaaS must not become the mandatory execution path for every project. PC01 already serves as the primary compute/control-node direction for TigerIQ.

## Decision
Use PC01 as a shared primary runtime platform with strict per-project isolation. Reuse physical infrastructure, not application state.

Each project receives its own repository/release lifecycle, service/process identity, port, runtime directory, config/secrets, data boundary, Work Order/evidence namespace, and independent rollback path.

Shared services such as Ollama, PostgreSQL host, Tailscale and machine telemetry may be reused through explicit interfaces. Shared capacity must be scheduled with bounded concurrency and priority so project workloads cannot starve TigerIQ control-plane functions.

Vercel is OPTIONAL SECONDARY/BACKUP hosting only where Internet reach has concrete value. `git.deploymentEnabled=false` remains the default. GitHub is source/CI/evidence coordination, not runtime evidence. Work mode and any single AI provider are replaceable execution clients, not architecture dependencies.

## Consequences
- Adding projects does not require adding Vercel projects or consuming deployment quota by default.
- One project can be restarted, upgraded or rolled back without stopping unrelated projects.
- Cross-project data writes are denied unless explicitly designed and authorized.
- PC01 becomes a small private platform and therefore needs project registry, resource allocation, service supervision, backup/recovery and capacity telemetry.

## Security boundary
No new public router exposure is authorized by this ADR. Private Tailscale/local access remains preferred. No shared secret may be reused across projects merely for convenience.

## Validation required before Accepted
- independent architecture review;
- verify compatibility with WO-059 PC01 Command Center primary path;
- define project registry/service allocation contract;
- prove isolated lifecycle using at least two non-production sample services or real projects without cross-project state leakage;
- record evidence and Judge decision.
