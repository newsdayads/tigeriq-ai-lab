# Cline Executor Evaluation Harness

Scope: #4532 — evaluate Cline as a bounded coding executor without changing TigerIQ Core authority.

## Purpose

This harness creates the same three deterministic coding fixtures for two isolated lanes:

- `cline-local-ollama`
- `current-coding-lane`

Each fixture starts with failing acceptance tests. Executors receive only `TASK.md` and the fixture directory. They must not edit tests.

## Seed

```bash
node benchmarks/cline-executor-eval/harness.mjs seed --root <temp-root> --lane cline-local-ollama --force
node benchmarks/cline-executor-eval/harness.mjs seed --root <temp-root> --lane current-coding-lane --force
```

## Execute

Use the same model where technically possible. For the Cline lane, prefer local Ollama and an isolated Cline data directory. Record exact Cline version, Ollama model/digest, start/end timestamps, attempts, command failures, reported usage, and checkpoint restores.

Do not give either lane permission to mutate TigerIQ main, policy, credentials, App Chrome, or Production.

## Score

```bash
node benchmarks/cline-executor-eval/harness.mjs score --root <temp-root> --lane cline-local-ollama
node benchmarks/cline-executor-eval/harness.mjs score --root <temp-root> --lane current-coding-lane
```

A fixture is complete only when its acceptance tests pass, tests and TASK.md were not modified, and no unexpected files were added. The scorer derives its baseline only from the repository-owned fixture-manifest.json; it never trusts baseline metadata inside an executor-writable lane. The external benchmark runner adds wall-clock, attempts, command failures, model/provider and usage metrics before the final KEEP/CANARY/REJECT decision.
