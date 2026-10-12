# Cline Executor Evaluation Harness

Scope: #4532 — evaluate Cline as a bounded coding executor without changing TigerIQ Core authority.

## Purpose

This harness creates the same three deterministic coding fixtures for two isolated lanes:

- `cline-local-ollama`
- `current-coding-lane`

Each fixture starts with failing acceptance tests. Executors receive only `TASK.md` and the fixture directory. They must not edit tests.

## Seed

```bash
node benchmarks/cline-executor-eval/harness.mjs seed --root <NEW-EMPTY-ISOLATED-ROOT> --lane cline-local-ollama
node benchmarks/cline-executor-eval/harness.mjs seed --root <NEW-EMPTY-ISOLATED-ROOT> --lane current-coding-lane
```

Never point `--root` at an existing TigerIQ workspace, Production, or any non-disposable directory. `--force` is forbidden: seeding refuses to overwrite an existing lane. Fixture subprocesses receive no credentials. Live PC01 benchmarking still requires its own authorized isolated executor.

## Execute

Use the same model where technically possible. For the Cline lane, prefer local Ollama and an isolated Cline data directory. Record exact Cline version, Ollama model/digest, start/end timestamps, attempts, command failures, reported usage, and checkpoint restores.

Do not give either lane permission to mutate TigerIQ main, policy, credentials, App Chrome, or Production.

## Score

```bash
node benchmarks/cline-executor-eval/harness.mjs score --root <NEW-EMPTY-ISOLATED-ROOT> --lane cline-local-ollama
node benchmarks/cline-executor-eval/harness.mjs score --root <NEW-EMPTY-ISOLATED-ROOT> --lane current-coding-lane
```

A fixture is complete only when its acceptance tests pass, tests and TASK.md were not modified, and no unexpected files were added. The scorer derives its baseline only from the repository-owned fixture-manifest.json; it never trusts baseline metadata inside an executor-writable lane. The external benchmark runner adds wall-clock, attempts, command failures, model/provider and usage metrics before the final KEEP/CANARY/REJECT decision.

## Gate for a real measured Cline–NV09 decision

Use `decision-gate.mjs` only after the authorized isolated PC01 runner has produced
**two genuine lane scores and original execution traces** for all three canonical fixtures.
`evaluateBenchmarkComparison({cline,nv09,verifyTrustedReceipt})` fails closed unless
both lane receipts match the same local Ollama model digest and manifest, contain
the complete raw scorer output and nonzero wall-clock / resource / attempt metrics,
and a **trusted runtime verifier** validates immutable source, logs, and
filesystem/process/network/resource/credential containment evidence.

Neither a GitHub comment, a preflight `DONE`, nor `verified:true` in JSON is a
trusted proof. The returned `KEEP` / `CANARY` / `REJECT` is only a candidate
decision; it does not grant merge, Core routing or Production authorization.
Tests of this decision function use synthetic fixtures solely to prove its
fail-closed behavior; they are **not the actual PC01 benchmark**.
