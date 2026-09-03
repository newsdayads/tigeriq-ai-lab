# PC01 Cloudflare Remote Access V1

Date: 2026-09-04
Status: REPOSITORY DESIGN — ACCOUNT/DOMAIN DEPLOYMENT PENDING

## Decision
PC01 remains the primary runtime/source node. External browser access should use Cloudflare Tunnel + Access so the daily-use phone does not require a VPN/Tailscale client. Tailscale remains technical/emergency administration only. Vercel remains preview/backup/launcher only.

## Route model
- AI Lab Command Center: public Access-protected hostname → Cloudflare Tunnel → `http://127.0.0.1:8787` on PC01.
- TigerIQ Driver: separate Access-protected hostname → the Driver localhost service/port on PC01.
- Final ingress rule must fail closed with `http_status:404`.
- No inbound router port exposure is required for the tunnel model.

Template: `config/cloudflare/tunnel.template.yml`.

## Security boundary
- Cloudflare Access authenticates before origin access.
- PC01 services stay bound to loopback unless a separate reviewed requirement exists.
- Real tunnel credentials, API tokens, Access service tokens and secrets never enter GitHub/frontend/evidence.
- Existing Command Center write authorization/CSRF/session controls remain in place behind Access; Access is not treated as a replacement for application authorization.
- Dashboard currently sends `frame-ancestors 'none'` / `X-Frame-Options: DENY`; therefore Vercel must not iframe the Command Center. Use direct hostname navigation/redirect/launcher.

## Physical/account acceptance
Requires Owner/account interaction and therefore is not repository-DONE until evidence exists for:
1. Cloudflare account/domain available.
2. Tunnel created and `cloudflared` installed as a PC01 service.
3. Ingress config validates.
4. AI Lab hostname reaches PC01 Command Center from normal mobile browser without Tailscale/VPN.
5. Access policy rejects unauthorized browser sessions.
6. Driver hostname is isolated from AI Lab route/state.
7. PC01 reboot automatically restores tunnel and local services.

## Reference verification
Cloudflare official documentation reviewed 2026-09-04: published application ingress maps hostnames to localhost services, requires a final catch-all ingress rule, and Tunnel creates outbound connectivity without opening inbound firewall/router ports. Cloudflare Access supports browser access to self-hosted/private web apps without a VPN client.
