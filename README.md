# TigerIQ AI Lab

TigerIQ AI Development Control Center — an evidence-gated, multi-agent control plane for software delivery.

## Core rule
**Evidence > AI opinion.** No evidence means no PASS and no merge.

## V1 foundation
- TypeScript / Node.js
- Work Order Engine
- Agent Orchestrator
- Model Router
- Evidence Engine
- Gate Engine
- GitHub Adapter
- Sandbox + Audit Log
- Golden Dataset contracts
- Vitest + Playwright + GitHub Actions

## Model strategy
Primary low-cost path: Gemini API Free -> OpenRouter free models -> Ollama local. OpenAI and Anthropic remain optional adapters.

## Governance
Coding agents cannot self-declare DONE, cannot merge MAIN, and cannot access production secrets. Reviewer and Judge must be independent from the Coding Agent.

See `AGENTS.md` and `docs/` for architecture, workflow, security and current state.
