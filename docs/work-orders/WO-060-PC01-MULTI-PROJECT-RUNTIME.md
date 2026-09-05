# WO-060 — PC01 Multi-Project Runtime Architecture

Date: 2026-09-03
Priority: P1
Status: ACTIVE — repository design prepared; review/gate pending

## Goal
Make TigerIQ capable of hosting multiple independent projects on PC01 without making Vercel, Work mode, or one AI provider a mandatory dependency.

## Scope
- define shared-PC01 / isolated-project architecture;
- define project runtime/data/config/evidence boundaries;
- define shared-service rules for Ollama, PostgreSQL host, Tailscale and telemetry;
- preserve Vercel as optional secondary/backup only;
- define minimum onboarding and validation gates for future projects.

## Out of scope
- modifying the currently running WO-059 PC01 installation/runtime;
- public Internet exposure;
- Production release;
- paid infrastructure;
- destructive database migration.

## Acceptance criteria
1. Architecture explicitly supports multiple isolated projects on one PC01.
2. A project has independent repo/release, service/process, port, runtime directory, config/secrets, data and Work Order/evidence namespace.
3. Shared compute/services are bounded and cannot allow one project to starve the control plane.
4. Vercel automatic Git deploy remains disabled and Vercel is not required for normal engineering/runtime operation.
5. Project onboarding contract includes build/test/review/release, resource budget, exposure policy, persistence and rollback.
6. Independent reviewer/judge records a decision before merge.

## Current evidence
- `docs/ARCHITECTURE.md` updated on branch `wo-060-multi-project-runtime-architecture`.
- ADR `docs/ADR/0012-pc01-shared-multi-project-runtime.md` created.
- Existing Vercel policy already enforces `git.deploymentEnabled=false`.
- WO-059 remains separate and owns physical PC01 Command Center deployment/testing.

## Next safe actions
1. Open PR for independent review.
2. Run repository CI.
3. If review passes, merge only through applicable gate.
4. After WO-059 physical runtime is stable, implement project registry/service allocation as a separate Work Order and prove isolation with two services/projects.

## DONE rule
This WO is DONE only when design is reviewed/gated, merged, evidence recorded, and the next implementation Work Order is unambiguously scoped. It does not claim multi-project runtime implementation or physical validation.
