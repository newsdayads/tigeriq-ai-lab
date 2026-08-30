# Security and Permission Model

Principles: least privilege, workspace isolation, secret isolation, command allowlists, resource/time limits, immutable evidence and complete audit trails.

## Roles
- Architect: read-only source/spec access.
- Coding Agent: write only to isolated branch/worktree; no MAIN push, no production deploy, no production secrets.
- Reviewer: read-only diff/repository access; must be independent from the Coding Agent.
- QA: test execution in sandbox; cannot alter acceptance criteria or Golden expected outputs.
- Judge: read-only evidence evaluation; cannot mutate code or tests.
- Release Manager: may prepare PR/Preview. MAIN/Production actions are privileged and require all required gates.

## Secrets
Never commit provider keys, GitHub tokens, Vercel tokens, credentials or .env files. Use runtime environment variables / GitHub Secrets / deployment secret stores.

## Threats addressed
Prompt injection from repository content, agent privilege escalation, secret exfiltration, fake PASS claims, test weakening, Golden Dataset poisoning, uncontrolled shell commands and direct production mutation.

## Phase 3 API controls

- Default listener is loopback-only with an ephemeral port in tests.
- Health is public; all Work Order state requires a valid bearer credential.
- Tokens are compared as fixed-length SHA-256 digests with timing-safe equality and are never returned.
- Mutation requests require `application/json`, a maximum body size, and an idempotency key scoped to the actor.
- Input is validated before domain invocation; authorization failures use 403 and do not become internal errors.
- Production still requires managed identity, TLS, durable idempotency, rate limiting, structured redacted logs, and secret rotation.
