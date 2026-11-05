# TigerIQ — Execution Boundary

Updated: 2026-11-05
Status: OWNER-ENFORCED / PC01-ONLY NEW WEB SYSTEMS
Authority: current explicit Owner instruction; Issue #5648.

## Engineering and deployment
- Source-code implementation, refactoring, fixes, repo edits, branches/PRs, and review use **GitHub**. Validation uses **GitHub CI**.
- **ALL NEW** website/application releases use **PC01 local origin** and `*.tigeriq.io.vn` over the existing Cloudflare Tunnel. No new Vercel projects or deployments, webhooks, Git integrations, or Vercel-dependent release templates.
- Publish only after passing exact-head CI, appropriate release gates, local app health, subdomain collision checks, HTTPS smoke test, and rollback preparation.
- Legacy Vercel deployments remain live until individually migrated and accepted. Never delete legacy Vercel projects or disrupt their public endpoints during policy transition.

## PC01 operations scope
- PC01 hosts device-bound/local runtime: TigerIQ Core, PostgreSQL, Ollama, hardware integrations, application origins, Cloudflare Tunnel, and the approved local wildcard HTTP router.
- PC01 is NOT a normal development machine; never edit GitHub source, commit/push, create dev worktrees, or perform ordinary source builds on PC01.
- Installing, supervising, rolling back and testing approved/reviewed application artifacts on PC01 is a runtime release operation, not source coding.
- Existing Tunnel ingress routes have precedence; new wildcard router rule only after explicit hostname rules and before terminal 404. Coordinate with active resource writers before modifying `D:\TigerIQ\CloudflareRuntime\config.yml`.
- Use locally managed DNS wildcard `*.tigeriq.io.vn` (already provisioned on 2026-11-05, per issue #5648), a fail-closed router registry, localhost-only upstreams, and no inbound Internet firewall exposure.
- Public app registration is explicit opt-in, healthchecked, atomic, uniqueness-checked, and rolled back if public HTTPS fails. Never expose administrative/internal APIs by inference.
- Existing Windows elevation/UAC, one-writer locks, secret-management, Cloudflare account permissions, production permissions, and no-cost restrictions remain mandatory.

## Fail-closed
- If an engineering task cannot proceed through GitHub/CI, do not silently implement source via PC01 shell or substitute Vercel.
- If PC01 installation/restart needs elevated access or a protected writer lock, keep running production intact and report the exact blocked action and verified evidence.
- Source changes and runtime releases have separate acceptance receipts.

STATE: `GITHUB_CI_TO_PC01_CLOUDFLARE_WILDCARD_V1`
