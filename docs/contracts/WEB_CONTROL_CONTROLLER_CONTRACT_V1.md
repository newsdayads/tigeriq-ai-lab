# TigerIQ Web Control ↔ Workforce Controller Contract V1

Status: Web-side contract owned by CHAT 01. Controller implementation remains with the backend/runtime streams.

## 1. Architecture boundary

- `PC01 + PostgreSQL + Workforce Controller` are the operational Source of Truth.
- `Tailscale` is the primary private network path.
- Web Control is the Owner-facing company dashboard and intent client.
- Vercel may host the static Web UI and optional Owner UI identity only. It is not queue, scheduler, controller, retry engine, evidence store, reviewer or judge.
- GitHub is source/version/review/CI evidence only. Web V1 never derives live job state from Issues, PRs, Actions or deployments.
- If Vercel is unavailable, PC01/Controller/workers/jobs continue. The same Web bundle may be served locally/tailnet and point to the same Controller.

## 2. Confirmed existing Controller probe

`GET /api/workforce/status`

This is only a connectivity/aggregate probe. It is not rich enough to drive the complete Web V1 company dashboard.

The existing `POST /api/admin/tasks` is intentionally not called by browser Web V1 because it requires Controller admin authority. The browser must never hold or send `x-tigeriq-admin-secret`.

## 3. Authoritative dashboard snapshot

`GET /api/web/v1/snapshot`

Required response envelope:

```json
{
  "schemaVersion": "tigeriq.web-control.snapshot.v1",
  "generatedAt": "ISO-8601",
  "source": {"mode":"controller","authoritative":true,"label":"PC01 Workforce Controller"},
  "controller": {},
  "owner": {},
  "company": {},
  "departments": [],
  "jobs": [],
  "employees": [],
  "devices": [],
  "providers": [],
  "prompts": [],
  "results": [],
  "checks": [],
  "activity": []
}
```

Web Controller mode fails closed unless `schemaVersion` matches exactly, `source.mode=controller`, `source.authoritative=true`, `generatedAt` is valid and every required dashboard collection is an array.

## 4. Company / progress model

Recommended `company` shape:

```json
{
  "name": "TigerIQ AI Lab",
  "version": "V1",
  "phase": "...",
  "operatingMode": "...",
  "currentObjective": "...",
  "truthPolicy": "...",
  "progress": {"percent":0,"label":"...","note":"..."},
  "readiness": [{"key":"job001","label":"JOB-001","state":"PENDING|READY|RUNNING|PASS|FAIL|BLOCKED","evidence":null}],
  "workforceSummary": {}
}
```

Progress/readiness are Controller data. Web must not calculate a company runtime PASS from GitHub/Vercel metadata.

## 5. Departments / workforce

`departments[]` supports `departmentId`, `name`, `purpose`, `leadEmployeeId`, `employeeCount`, `activeJobs`, `health`.

`employees[]` supports `employeeId`, `displayName`, `department`, `role`, `nodeId`, `provider`, `model`, `availability`, `healthScore`, `activeTaskCount`, `concurrencyLimit`, `capabilities`, `lastHeartbeatAt`.

`devices[]` supports `nodeId`, `displayName`, `kind`, `platform`, `status`, `tailscaleIp`, `controllerPort`, `agentVersion`, `lastHeartbeatAt`, optional battery/temperature.

Online/idle/busy status is valid only when Controller supplies it. Web never promotes `unknown` to online.

## 6. Jobs / queue / recovery

Recommended normalized stages: `QUEUED`, `ASSIGNED`, `RUNNING`, `WAITING_REVIEW`, `WAITING_JUDGE`, `COMPLETED`, `FAILED`, `BLOCKED`, `CANCELLED`.

`jobs[]` may include `department`, `priority`, `assignedEmployeeId`, `requiredCapabilities`, `attempts`, `maxAttempts`, `blocker`, `recovery`, `progress`, timestamps.

Web treats stage/progress/blocker as display data only. Retry policy, dedupe, leases and recovery eligibility remain Controller/orchestration responsibilities.

## 7. AI providers

`providers[]` supports `providerId`, `displayName`, `role`, `health`, `billingMode`, `credentialPresent`, `quota`, `models`, `successRate`, `latencyP50Ms`, `lastCheckedAt`.

Provider health/quota must come from Controller telemetry. Web must not infer health from a previous request failure or external dashboard.

## 8. Prompt Architect

`prompts[]` contains prompt library records, active version and version metrics. Versions may include `runs`, `pass`, `fail`, `passRate`, `avgLatencyMs`.

Write intent: `POST /api/web/v1/prompts/versions`, schema `tigeriq.web-control.prompt-version.v1`.

## 9. Result / Evidence / Review / Judge

`results[]` is the job output projection with `resultId`, `jobId`, `employeeId`, `status`, `conclusion`, `provider`, `model`, `confidence`, `artifacts`, `evidence`, `review`, `judge`, `completedAt`.

`checks[]` is the explicit QA/audit projection with `checkId`, `jobId`, `name`, `state`, `detail`, `at`.

Web must never call a job DONE solely because result text exists. Terminal presentation comes from Controller data and the evidence/review/judge gates defined by Work Management.

## 10. Activity history

`activity[]` contains runtime audit events (`eventId`, `at`, `type`, `actor`, `message`, optional `jobId`). This replaces the old practice of treating GitHub Issue comments as runtime activity.

## 11. Owner write intents

- `POST /api/web/v1/goals` — Owner goal intent. Controller/Work Management owns decomposition and dispatch.
- `POST /api/web/v1/prompts/versions` — prompt version intent/storage.
- `POST /api/web/v1/jobs/:jobId/retry` — retry request intent only; Controller decides eligibility, attempts, dedupe and execution.

Web must not generate internal TaskPacket decomposition that duplicates CHAT 03/04/06 logic.

## 12. Authentication / Tailscale / CORS

- Existing Google Owner login can remain UI identity on Vercel; it does not itself authorize Controller operations.
- Controller must enforce operational authorization using a browser-safe short-lived capability/session. Current Web client stores optional bearer only in `sessionStorage`; admin secret is forbidden.
- Controller targets are restricted to local/Tailscale hostnames or CGNAT `100.64.0.0/10` addresses.
- An HTTPS-hosted UI rejects an HTTP Controller target due browser mixed-content rules.
- Preferred remote target: `https://pc01.<tailnet>.ts.net`.
- Cross-origin Vercel → Tailscale Controller requires a narrow allowlist CORS policy and browser-safe authorization. Same-origin/local Web on PC01 is also valid.

## 13. Mock mode

Mock mode exists only to complete/test UI before PC01 is physically available:

- `source.mode=mock`
- `source.authoritative=false`
- mock entities are visibly labeled `MẪU`
- mock submit/retry actions return local draft responses and never dispatch
- mock RUNNING/COMPLETED/PASS examples are demonstrations only and must never be surfaced as real PC01 state
- a failed live Controller connection must show `CONTROLLER OFFLINE`; Web must not silently fall back to mock while claiming live
