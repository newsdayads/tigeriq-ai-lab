# PC01 — Wildcard DNS and automatic public website/app onboarding

OWNER_DIRECT=2026-11-05 | ISSUE=5648
STATUS=DNS_WILDCARD_PROVISIONED_ROUTER_SOURCE_PENDING_EXACT_HEAD_CI_AND_PC01_ACCEPTANCE
POLICY=PC01_ONLY_NEW_APPS_NO_NEW_VERCEL
ONE_WRITER_CONFIG_GATE=REQUIRED
WILDCARD_DNS_PROVISIONED=2026-11-05T09:27:37Z
DNS_RECEIPT=JOB-MCP-55650549-fdff-4188-9cc8-dedc27c0f7d2

## Architecture

- Canonical source: GitHub newsdayads/tigeriq-ai-lab main with branch → PR → exact-head CI.
- Runtime: PC01, local HTTP origin. Public URL: app-name.tigeriq.io.vn, one label only.
- Cloudflare tunnel: 6e1b0f48-cf73-420b-ba3e-9fbb0efc4e61.
- Wildcard DNS CNAME *.tigeriq.io.vn points to the existing Tunnel. Cloudflare CLI confirmed creation 2026-11-05. PC01 read-only DNS subsequently resolved a previously nonexistent hostname to Cloudflare proxied A records.
- Existing specific routes (tigeriq.io.vn, driver, ai, city, 3d) take precedence and are not modified.
- Single wildcard tunnel ingress *.tigeriq.io.vn to http://127.0.0.1:8891; Node router reads D:\TigerIQ\CloudflareRuntime\subdomains.json and allows only registered one-label hosts to loopback origins. Unknown hosts return 404.
- No DNS mutation per app. No new Vercel deployment or integration. Existing Vercel production remains until accepted migration.

## One-time activation on PC01 AFTER exact-head CI and writer gate

1. Install the approved file apps/tigeriq-subdomain-router/server.mjs as D:\TigerIQ\CloudflareRuntime\router.mjs, plus registrar scripts/pc01/register-public-webapp.ps1 into the same runtime directory. Verify SHA; do not code/build source on PC01.
2. Initialize D:\TigerIQ\CloudflareRuntime\subdomains.json with content: {"version":1,"routes":{}}. NEVER overwrite an existing registry.
3. Run the router under an authorized, persistent Windows scheduled task or service on 127.0.0.1:8891. Test with Host: localhost at http://127.0.0.1:8891/__router/healthz (200); unknown hostname returns 404. Persistence across logoff/reboot must also be checked.
4. Acquire current one-writer right for D:\TigerIQ\CloudflareRuntime\config.yml (Issue #5646 was actively modifying this resource). Record original SHA and backup current file. Add wildcard ingress AFTER existing explicit hostname rules and BEFORE final - service: http_status:404:
       - hostname: "*.tigeriq.io.vn"
         service: http://127.0.0.1:8891
5. Validate using cloudflared tunnel --config [configpath] ingress validate and ingress rule https://canary.tigeriq.io.vn. Restart only the designated connector with legal Windows service/task elevation. Do not bypass any Access Denied by another connection.
6. Check existing public websites still serve correctly, unknown public subdomain returns 404 and router local health returns 200. On failure restore immediate backup and revalidate, restart with authorized permissions, record receipt.

## Every NEW publicly approved web/app

1. Release pipeline deploys CI-verified source artifact as a PC01 loopback-only service; example origin http://127.0.0.1:PORT with a health URL returning 200. Do not open inbound public firewall ports.
2. Public intent must be explicitly declared in project release metadata. Do not auto-expose arbitrary listening ports or administrator/internal APIs.
3. Release pipeline invokes: register-public-webapp.ps1 -Name app-name -Port PORT -HealthPath /healthz -Public
4. Registration checks unique DNS label, reserved hostnames, existing Tunnel hosts/ports, registry collisions, wildcard DNS, healthy router, healthy origin. Exclusive lock and atomic replacement protect registry updates. Checks both local Host-based route and public HTTPS. Any failed check restores the preceding registry.
5. Mark PUBLIC only after 200, HTTPS, route health and rollback evidence. Re-register same name/port returns ALREADY_REGISTERED.

## Boundaries

- One-time wildcard DNS does NOT itself authorize public app publication: router registry denies all unknown hosts.
- Do not copy cert.pem, Tunnel credentials or Cloudflare API secrets into GitHub, logs or output.
- Do not create a second controller/queue or parallel Tunnel.
- Do not claim installation accepted merely from DNS success or a PR.
- No new cost, DNS overwrite, nameserver mutation, destructive operation or bypass of PC01 elevation and one-writer boundaries.
