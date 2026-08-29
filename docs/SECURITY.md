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
