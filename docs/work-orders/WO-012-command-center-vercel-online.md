# WO-012 — TigerIQ Command Center Vercel Online

## Objective
Deploy TigerIQ AI Lab Command Center as an isolated Vercel project linked only to `newsdayads/tigeriq-ai-lab`, without modifying or linking to the Tiger IQ Driver Vercel project/repository.

## Branch
`wo012/command-center-vercel-online`

Base: `wo010/command-center-web-control`

## Online architecture
Browser → Vercel static UI → Vercel Function `/api/control` → GitHub REST API → durable TigerIQ issue queue/evidence.

PC01 is an execution worker behind the online control plane. PC01/OpenClaw/Ollama availability does not block the online UI from deploying; unavailable execution capabilities must be reported as offline/unknown rather than fabricated.

## Required Vercel environment variables
- `TIGERIQ_COMMAND_SECRET` — high-entropy operator secret; never commit.
- `TIGERIQ_GITHUB_TOKEN` — GitHub credential scoped only as required to create/read issues in `newsdayads/tigeriq-ai-lab`; never commit.
- `TIGERIQ_REPO=newsdayads/tigeriq-ai-lab`
- `TIGERIQ_PC01_CANARY_ISSUE=58`

## Security gates
- No secrets in repository.
- No Tiger IQ Driver repository/project mutation.
- No MAIN/Production merge before preview verification.
- Browser sends the operator secret only in `x-tigeriq-secret`, not URL/query string.
- Server-side GitHub credential is never returned to the browser.
- Command Center only emits bounded TigerIQ Work Order / deterministic canary issue formats.

## Preview acceptance gates
1. Vercel deployment is linked to `newsdayads/tigeriq-ai-lab` only.
2. `/api/control` GET returns service health without credentials.
3. Wrong/missing command secret returns 401.
4. Authenticated status returns `vercel=online`, `github=online` and truthful PC01/OpenClaw/Ollama states.
5. Work Order creation creates one GitHub issue in `newsdayads/tigeriq-ai-lab` only.
6. Canary creation emits valid `TIGERIQ_COMMAND_V1` JSON for `system.status`.
7. Tiger IQ Driver production deployment remains unchanged.

## Current state
Code prepared off-MAIN. Vercel project creation/link and encrypted environment variables remain external setup gates.
