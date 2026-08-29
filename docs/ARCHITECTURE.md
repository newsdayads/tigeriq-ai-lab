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
