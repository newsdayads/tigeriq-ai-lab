# PC01 self-hosted OAuth acceptance

Owner scope: ChatGPT to authenticated TigerIQ MCP on PC01, without WorkOS or a new external identity provider. Related work: #5365 - Xác thực ChatGPT và điều khiển PC01 trực tiếp.

## Invariants
- The authorization server runs within the existing loopback MCP gateway, behind its existing HTTPS origin.
- Only the official ChatGPT CIMD client and its published stable callback are accepted. Metadata fetch is HTTPS, exact-host, no redirects; no arbitrary client URL fetching.
- Owner login requires a strong locally provisioned private Owner code; its scrypt hash is compared in constant time. No identity inferred from Origin, loopback IP, a chat message, or possession of a client ID.
- Authorization requires a browser-bound, expiring consent request, matching same-origin POST and a correct Owner code. Show requested scopes before approval.
- Authorization codes expire in 60 seconds, are single-use, and bind exact client, redirect, resource, scopes and S256 challenge. Reject missing/plain PKCE and invalid verifier.
- RS256 tokens contain exact issuer, resource audience, authenticated Owner subject, expiry and only consented scopes. Private RSA key remains outside GitHub and tool logs. JWKS exposes public fields only.
- Short-lived access tokens and rotating refresh tokens are bound to the same client; refresh cannot expand scopes. Unknown, expired or consumed grants fail closed.
- Bound request bodies, pending requests, client metadata cache and login attempts. Reject cross-origin/CSRF requests and callback injection.
- Existing MCP scope checks, path checks, mutation fences, audit and Windows permissions remain authoritative. An OAuth token never grants an unconditional elevated shell or SYSTEM.
- Runtime activation is separate: branch/CI/merge and installed release guard, protected local config/key, rollback backup, actual ChatGPT login and negative/live Admin tests before DONE.

## Acceptance
Existing live RED: public protected-resource discovery returns 503 OAUTH_RUNTIME_NOT_CONFIGURED, while ChatGPT plugin reports supported/used authorization: none. Tests must cover correct authorization-code/PKCE flow and failures for invalid owner login, CSRF, client, redirect, resource, PKCE, code replay/expiry, scope escalation, token signature/issuer/audience, refresh replay/expiry, public-only JWKS and request limits. Native host acceptance is distinct from source tests.

## Ownership
This branch owns only the new authorization-server module, its tests, and minimal gateway activation integration. Existing readiness work in PR #5439 - Chặn OAuth kích hoạt khi metadata chưa đầy đủ remains separate; do not rewrite its verifier or tests. No new queue, provider account, paid service, or authentication bypass.
