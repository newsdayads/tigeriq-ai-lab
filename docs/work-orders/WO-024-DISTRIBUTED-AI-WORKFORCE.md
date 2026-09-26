# WO-024 — TigerIQ Distributed AI Workforce

Priority: P0
Status: REMOTE CORE DONE — PHASE 1 ACTIVE
Date: 2026-08-30

## Owner intent
Transform TigerIQ AI Lab from a single-agent execution pattern into a company-scale distributed AI workforce. The Owner should communicate with one Chief of Staff. The Chief delegates through departments/team leads to many replaceable AI/device workers running concurrently. Physical Android phones, PC01, cloud APIs, local models and browser/tool workers are execution resources, not the company hierarchy itself.

## Operating model
Owner -> Chief of Staff -> Department Head -> Team Lead -> AI Employees -> Independent Reviewer -> Judge/Gate -> Evidence -> Chief -> Owner.

## Verified remote core
1. Workforce Registry: employee identity, department/team/role, node binding, provider/model metadata, capabilities, health, availability, concurrency and outcome metrics.
2. Worker Node Registry: Android/API/local/browser/tool/simulator node contract with heartbeat and device health metadata.
3. Organization hierarchy: company, department and team units with logical manager agents.
4. Task Packet contract: objective, constraints, inputs, required capabilities, expected artifacts, deadline, bounded attempts, review policy and idempotency key.
5. Capability-aware scheduler: health/success/load/department/team scoring, concurrency limits and exclusion rules.
6. Durable runtime boundary: checkpoint snapshot/store interface, restart restore, in-flight fail-safe requeue and duplicate suppression.
7. Canonical idempotency: a duplicate request with a different taskId executes/returns the original canonical task and never creates a second execution.
8. Structured Result/Evidence contract: conclusion, confidence, verdict, artifacts, risks and bounded failure metadata.
9. Independent assurance: primary workers cannot review/judge their own work. Provider/model diversity is preferred but falls back to another independent employee when no diverse provider is available, preventing workforce deadlock.
10. Worker adapter boundary: Android/API/local/browser/tool/simulator implementations are replaceable.
11. Simulator gate: two primary employees execute concurrently, then an independent Reviewer and Judge evaluate the result.
12. Read-only Workforce status projection: node status/kind counts, employee availability/capacity/utilization, department/provider distribution and task lifecycle counts.
13. Secure worker-node pairing primitive: short-lived one-time challenge, proof-verification boundary, scoped revocable node credential and token-hash-only storage.
14. Android Worker MVP contract: identity, foreground service, task inbox, Accessibility bridge, evidence collection, watchdog, result publisher, secure pairing and real-device acceptance criteria.
15. JSON schemas for node, task and result contracts.

## Hardened invariants
- One physical phone may represent one persistent AI employee identity; hardware never becomes the company hierarchy.
- AI providers are replaceable brains/tools, not employee identities.
- Duplicate Task Packets are canonicalized by idempotency key across restart.
- In-flight work is never assumed DONE after restart; it is recovered/requeued only within remaining maxAttempts.
- Reviewer/Judge must be different employees from the work being evaluated.
- Provider diversity is a preference, not a reason to halt if an independent same-provider employee is the only eligible reviewer.
- No credentials, account passwords, tokens or private Owner data may be committed or returned in evidence.
- Consumer-app automation remains isolated behind provider-specific adapters and may only be enabled where technically/account-policy appropriate.
- No claim of live Android control is allowed until physical-device evidence exists.

## Gate evidence
- Final exact branch head: `abd92ea5c2dd9d84f2c84f984897ac97b452223b`.
- Replacement PR #81 was used because the GitHub connector Ready-for-review mutation failed on an unsupported GraphQL field; no code changed during PR replacement.
- PR #81 exact-head CI run `33324214335`: PASS.
- PR #81 exact-head Queue Hygiene run `33324214327`: PASS.
- PR #81 exact-head Vercel Verify run `33324214405`: PASS.
- PR #81 merged to MAIN as `295b0b17add37289104c1dc64739ee2694cb8443`.
- Production deployment `dpl_9KBTs1QwkGqEQJuPvTES6eMDtxfv`: READY and aligned to merge SHA `295b0b17...`.
- Canonical Production `GET /api/control`: HTTP 200 after deploy; Vercel/GitHub online, existing Web Control capabilities preserved, queue remained exactly #57/#58.
- No Tiger IQ Driver mutation, no PC01 runtime mutation, no provider/billing activation.

## Not yet claimed
- No physical Android phone has been paired or controlled by this Work Order.
- No Accessibility permission has been granted on a real device.
- No ChatGPT/Gemini/Claude consumer app automation is claimed.
- No live provider credential or paid service is activated.
- The state-store contract is implemented/tested in memory; a production durable backend must be selected/configured before 24/7 live worker state is claimed.

## Active Phase 1
1. Production-safe durable Workforce backend + Control Plane API integration + mobile Workforce Board.
2. Buildable TigerIQ Worker Android APK and secure pairing endpoint.
3. Farm Gateway adapter for ADB/Appium/UiAutomator2/device inventory.
4. Two-phone real-device gate: pair + heartbeat + two concurrent tasks + result/evidence + independent review + disconnect/restart recovery.
5. Department planner, performance/KPI routing and scale tests at 5/10/20 workers.
