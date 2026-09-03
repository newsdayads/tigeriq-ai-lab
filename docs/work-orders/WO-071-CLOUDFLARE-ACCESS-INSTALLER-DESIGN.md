# WO-071 — Cloudflare Access + PC01 Installer Design

Date: 2026-09-04
Status: IMPLEMENTING — REPOSITORY GATE PENDING
Branch: `wo071/cloudflare-access-installer-design`
Base: `wo070/mobile-pwa-v1`
MAIN/Production: untouched

## Objective
Prepare a one-shot, fail-closed Windows package for exposing TigerIQ Web Control through Cloudflare Tunnel + Access without requiring Tailscale/VPN on the daily-use phone.

## Current official constraints verified 2026-09-04
- Cloudflare recommends running `cloudflared` as a Windows service for availability.
- Create/protect the Access application before publishing the tunnel route so the hostname is not temporarily public.
- Tunnel ingress must validate and end in a catch-all fail-closed rule.
- Access token validation at/near the origin is required to prevent bypass if routing is misconfigured.

## Repository scope
- Add a PowerShell planner/installer package that is DRY-RUN by default.
- Inputs are references only: tunnel UUID, credentials-file path, hostnames and ports. No secret material enters repo/log output.
- Validate localhost Web Control health before producing/applying a route.
- Render config to a machine-local directory outside the repository.
- Validate ingress using `cloudflared tunnel ingress validate`.
- Applying Windows service/registry changes requires BOTH `-Apply` and explicit `-AuthorizationCode OWNER_AUTHORIZED_CLOUDFLARE_APPLY`.
- No tunnel/account creation, DNS/Access policy mutation or credential generation is automated in this work order.

## Acceptance
1. Script parser PASS.
2. Dry-run produces a deterministic plan and never modifies service/registry/config files.
3. Missing Access-ready acknowledgement, credential reference, valid hostname, Web Control health or cloudflared blocks apply.
4. Rendered ingress binds AI Lab only to `127.0.0.1:8788` by default and ends with `http_status:404`.
5. No raw tunnel token/API key/credential content is accepted or logged.
6. Full repository CI PASS on exact code head.

## Physical/account gate
Actual Cloudflare account/domain/Access/Tunnel deployment and PC01 service installation remain authorization-gated and require separate physical evidence.
