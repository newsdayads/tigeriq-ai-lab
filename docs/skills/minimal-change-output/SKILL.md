# Minimal Change Output

## Identity
- ID: minimal-change-output
- Version: 1.0.0
- State: ACTIVE
- Target: coding-lane
- Provenance: registry.yaml; #1006; PR #1150; merge e08c7aa166e39584a7a70b72283fd280e51c3c04

## Trigger
Use for repository/source mutation, especially edits to existing files where an unnecessarily broad rewrite increases regression risk.

## Input
- Target path and before/after content.
- New-file versus existing-file state.
- Task acceptance, allowed scope, and applicable tests.

## Steps
1. Confirm code mutation is actually required.
2. Prefer the existing implementation/dependency over adding parallel mechanisms.
3. Select the smallest delta that satisfies acceptance.
4. Run the destructive-rewrite safety guard before write.
5. Verify with focused tests/checks and independent review when required.

## Tools / Output
Use the existing Coding Lane mutation path and safety guard. Output a minimal scoped diff plus safety decision and verification evidence.

## Acceptance
- New non-empty file creation is allowed.
- Small local edits are allowed.
- Empty/truncated existing files are rejected.
- Suspicious line, byte, or structural loss is rejected before write.

## Evidence
- #1006 - Safety Guard source-only repair.
- PR #1150 - accepted implementation evidence.
- apps/tigeriq-coding-lane/safety-guard.mjs

## Fallback
If a legitimate broad refactor is necessary, require explicit bounded scope and review evidence; never silently bypass the safety guard.

## Safety
Minimal LOC is not acceptance by itself. Correctness, tests, security, accessibility, and data safety take precedence. No direct main, Production, paid, credential/security, or destructive action is authorized.

## Non-goals
This skill does not prohibit justified refactors and does not replace repository-specific correctness or review gates.
