# TigerIQ — Public Showcase Website

Status: independent marketing website, not the authenticated TigerIQ Command Center.
Authority: GitHub newsdayads/tigeriq-ai-lab main; Work Order 5640.
Design: original Cuberto-style motion, red / near-black, thin Vietnamese-readable Roboto Flex, hotline 0392960003.

## Deployment
- Dedicated Vercel project: tigeriq-studio. Never overwrite tigeriq-ai-lab.
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
