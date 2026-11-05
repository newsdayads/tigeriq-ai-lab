# TigerIQ — Public Showcase Website

Status: independent marketing website, not the authenticated TigerIQ Command Center.
Authority: GitHub newsdayads/tigeriq-ai-lab main; Work Order 5640.
Design: original Cuberto-style motion, red / near-black, thin Vietnamese-readable Roboto Flex, hotline 0392960003.

## Deployment
- New releases: PC01 + Cloudflare Tunnel at tigeriq.io.vn. The preexisting Vercel project `tigeriq-studio` remains legacy/rollback-only until individually retired; do not create new Vercel deployments.
- Root Directory: apps/tigeriq-showcase
- Framework: Other / Static; no build dependencies; no paid services.
- Git source: newsdayads/tigeriq-ai-lab main, PR gates and live readback before acceptance.

## Public content / intelligent updates
- 7 services are the Owner-provided catalogue; they are not automatically production-released apps.
- UltraCar TEST is not advertised as publicly released.
- Each page reads public GitHub metadata for newsdayads/tigeriq-media-content (source pushed_at, not application health).
- New projects are discovered automatically ONLY when explicitly tagged with GitHub public topic "tigeriq-public-showcase" by the repository owner, non-archived, publicly readable and under newsdayads.
- Topic discovery shows only public repo name and official GitHub link. No issue texts, internal endpoints, APK URLs, secrets, progress percentages or work orders.
- GitHub rate-limit/offline => honest fallback; never invent data.
- Service/project descriptions remain curated through PR. Source commit activity must never be interpreted as LIVE / production acceptance.
- Git integration republishes curated content on changes to main; GitHub metadata can refresh on page view without deployment.

## Security and accessibility
- The site has no login or form backend. Telephone CTA only.
- No client credentials, private repos, paid services, tracking or cookies.
- Fetched GitHub strings are inserted with textContent, never innerHTML.
- The private Command Center and PC01/CORE APIs remain isolated.
- Reduced-motion and keyboard accessible service selection supported.

## Checks
node --check apps/tigeriq-showcase/main.js
node --test apps/tigeriq-showcase/test/site.test.mjs


## PC01 Cloudflare Tunnel origin (05/11/2026)
- Origin: PC01, loopback-only 127.0.0.1:8878; no inbound public firewall change.
- Canonical source: apps/tigeriq-showcase in GitHub main; PC01 Git sync only by authorized fast-forward.
- Node entrypoint: apps/tigeriq-showcase/server.mjs, zero dependencies.
- Health: http://127.0.0.1:8878/healthz returns service=tigeriq-showcase and status=ok.
- Cloudflare tunnel host tigeriq.io.vn (configured separately by Tunnel owner) must point to http://127.0.0.1:8878 only after local acceptance.
- Do not touch driver, ai, city Tunnel routes or their PC01 services.
- User-level task: TigerIQ Showcase PC01; startup/logon mode and privilege must be verified. No SYSTEM service claim without evidence.
- Earlier Vercel project is not the public DNS origin anymore.
- Public GitHub metadata refreshes in-browser; code edits on GitHub do not automatically deploy to PC01 without verified controlled sync.

## PC01 acceptance
- node --check apps/tigeriq-showcase/server.mjs
- node --test apps/tigeriq-showcase/test/site.test.mjs apps/tigeriq-showcase/test/server.test.mjs
- GET /healthz, /, /main.js, /style.css => HTTP 200 and correct content.
- Listener must be 127.0.0.1:8878 and site task/proc readback must match.
- HTTPS at tigeriq.io.vn must be verified after Tunnel routing is configured.
