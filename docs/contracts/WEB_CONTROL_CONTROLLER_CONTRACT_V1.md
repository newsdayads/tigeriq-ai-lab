# TigerIQ Web Control ↔ Workforce Controller Contract V1

Status: Web-side contract candidate for CHAT 01. Backend implementation belongs to CHAT 03/06 as applicable.

## Architecture boundary

- PC01 + PostgreSQL are the operational state authority.
- Tailscale is the primary network path.
- Workforce Controller is the only operational API source for Web Control.
- Vercel may serve static UI and optional Owner UI identity only. Vercel/GitHub are not the job queue, scheduler, controller, durable state store, or runtime truth source.
- If Vercel is unavailable, PC01/Controller/workers continue. The same Web bundle can be served locally/tailnet and pointed at the Controller.
- Web Control does not decompose goals, select providers, lease work, judge results, or decide retry policy. It sends intents and renders Controller state.

## Confirmed existing Controller endpoint

`GET /api/workforce/status` exists today and returns aggregate nodes/employees/tasks status. Web V1 uses it only as a connection probe because it does not contain the complete data required by the Owner console.

Existing task enqueue `POST /api/admin/tasks` is intentionally NOT called from browser Web V1 because it requires an admin secret. Browser code must never store or transmit the Workforce Controller admin secret.

## Required Web read contract (backend pending)

`GET /api/web/v1/snapshot`

Response MUST be authoritative and use:

```json
{
  "schemaVersion": "tigeriq.web-control.snapshot.v1",
  "generatedAt": "ISO-8601",
  "source": { "mode": "controller", "authoritative": true, "label": "PC01 Workforce Controller" },
  "controller": {},
  "company": {},
  "jobs": [],
  "employees": [],
  "devices": [],
  "providers": [],
  "prompts": [],
  "results": [],
  "activity": []
}
```

If this endpoint is absent, invalid, unauthenticated or returns a schema mismatch, Controller mode must fail closed. It MUST NOT fallback to GitHub Issues, PRs, Vercel deployment metadata, or mock data while still claiming live mode.

## Required Web write intents (backend pending)

- `POST /api/web/v1/goals` — Owner goal intent. Controller/orchestration layer owns decomposition and dispatch.
- `POST /api/web/v1/prompts/versions` — prompt version intent/storage contract.
- `POST /api/web/v1/jobs/:jobId/retry` — retry request intent only. Controller decides eligibility, dedupe, attempt count, policy and execution.

Web must not directly create TaskPacket internals that duplicate Work Management logic.

## Authentication boundary

- Existing Google Owner auth may remain as optional UI identity on Vercel.
- Controller itself must enforce operational authorization. The browser must not be trusted merely because the UI says Owner.
- Browser Web V1 supports a future short-lived Controller-issued bearer/capability or same-origin secure cookie. Token is session-only in the current client; admin secret is forbidden.

## Tailscale / browser transport

- Preferred remote UI path: HTTPS Tailscale/MagicDNS URL such as `https://pc01.<tailnet>.ts.net`.
- `http://100.64.0.0/10:8790` is accepted only when the Web page itself is served over HTTP/local context. An HTTPS Vercel page cannot safely call an HTTP Controller because browsers block mixed content.
- Public Internet Controller URLs are rejected by the Web client policy.

## Truthful state rules

- `RUNNING`, `COMPLETED`, provider quota/health, employee online state, evidence, review, judge, blocker and retry state are displayed only from the Controller snapshot.
- Mock mode is always visibly marked `MOCK`, `authoritative=false`; mock submit/retry actions never dispatch.
- Controller mode does not infer state from GitHub/Vercel and does not silently downgrade to mock on a failed connection.
