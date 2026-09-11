# TigerIQ — Execution Boundary

Date: 2026-09-11
Status: OWNER-ENFORCED
Authority: explicit Owner instruction

## Engineering path
- Source-code implementation, refactor, fixes, repository edits, commits, branches, pull requests, and normal code review run through **GitHub**.
- Normal repository validation runs through **GitHub CI**.
- Hosted Web/UI preview or release runs through **Vercel** when a hosted deployment is required.
- **PC01 is not a coding, repository-editing, web-build, or web-deploy machine.**

## PC01 scope
PC01 is reserved for device-bound/local runtime responsibilities: TigerIQ Core 24/7, PostgreSQL, Ollama/local AI, Desktop Commander Remote, local integrations, runtime diagnostics, and hardware/device-specific verification that genuinely requires PC01.

Desktop Commander on PC01 is **operations/diagnostics only**. It must not be used to edit repository source, create development worktrees, commit/push implementation, or run ordinary web/code build pipelines.

PowerShell/CMD processes that supervise Core, Ollama, Desktop Commander, or other local runtime components are runtime launchers only; their presence does not make PC01 an engineering execution lane.

## Fail-closed rule
If a coding/web task would otherwise be executed through PC01 CMD/PowerShell, stop that path and perform the work through GitHub/CI/Vercel instead.

A PC01 exception is allowed only when the requested work is inherently device/hardware/local-runtime bound and cannot be performed on GitHub/CI/Vercel. The exception must remain scoped to that local requirement and must not silently become the normal coding path.

STATE: `GITHUB_ONLY_ENGINEERING_PC01_RUNTIME_ONLY_V1`
