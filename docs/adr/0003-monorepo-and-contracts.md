# ADR 0003: TypeScript monorepo with JSON Schema contracts

- Status: Accepted
- Date: 2026-08-29

## Context

The control plane will grow into multiple services and interfaces that must share stable domain contracts.

## Decision

Use an npm-workspace-ready TypeScript repository and JSON Schema 2020-12 for cross-boundary records. Start with one core package and expand only when boundaries become real.

## Consequences

TypeScript provides strict internal types while JSON Schema supports language-neutral validation. Schema evolution will require explicit compatibility decisions.
