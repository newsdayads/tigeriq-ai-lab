# TigerIQ AI Lab

TigerIQ is an evidence-driven AI development control center. It coordinates work orders, coding agents, independent quality gates, immutable evidence, and audit events.

## Phase 0

This foundation establishes the governance contract, architecture, workflow, security baseline, JSON Schemas, a minimal TypeScript core, and CI.

```bash
nvm use
npm ci
npm run ci
```

Start with [AGENTS.md](AGENTS.md) and [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md). The governing rule is **Evidence > AI opinion**: an implementer cannot approve its own work or declare it done.
