# WO-024 — TigerIQ Distributed AI Workforce

Priority: P0
Status: IMPLEMENTING
Date: 2026-08-30

## Owner intent
Transform TigerIQ AI Lab from a single-agent execution pattern into a company-scale distributed AI workforce. The Owner should communicate with one Chief of Staff. The Chief delegates through departments/team leads to many replaceable AI/device workers running concurrently. Physical Android phones, PC01, cloud APIs, local models and browser/tool workers are execution resources, not the company hierarchy itself.

## Operating model
Owner -> Chief of Staff -> Department Head -> Team Lead -> AI Employees -> Independent Reviewer -> Judge/Gate -> Evidence -> Chief -> Owner.

## P0 scope
1. Workforce Registry: employee identity, department/team/role, node binding, provider/model metadata, capabilities, health, availability, concurrency and outcome metrics.
2. Worker Node Registry: Android/API/local/browser/tool/simulator nodes with heartbeat and device health metadata.
3. Organization hierarchy: company, department and team units with logical manager agents.
4. Task Packet contract: objective, constraints, inputs, required capabilities, expected artifacts, deadline, bounded attempts, review policy and idempotency key.
5. Capability-aware scheduler: health/success/load/department/team scoring, concurrency limits, exclusion rules and reviewer independence.
6. Task lifecycle: queued -> assigned -> running -> completed/failed with bounded retry/reassignment and duplicate suppression.
7. Structured Result/Evidence contract: conclusion, confidence, verdict, artifacts, risks and bounded failure metadata.
8. Independent assurance: primary workers cannot review/judge their own work; provider diversity is preferred when capacity allows.
9. Worker adapter boundary: Android/API/local/browser/tool/simulator implementations are replaceable.
10. Simulator gate proving Chief/manager fan-out to at least two parallel workers, then independent Reviewer and Judge, before physical-device claims are allowed.

## Android strategy
- One physical phone may represent one persistent AI employee identity, while the company hierarchy remains logical and independent of hardware.
- The future TigerIQ Worker APK owns employee/node identity, secure pairing, heartbeat, task inbox, foreground execution, Accessibility bridge, evidence capture, watchdog and result return.
- ADB/Appium/UiAutomator2/scrcpy are infrastructure capabilities and should be reused rather than reimplemented.
- Legacy Android can be controlled through a farm gateway; newer Android can additionally run a more autonomous Worker APK.
- No claim of live Android control is allowed until real-device evidence exists.

## Provider policy
- AI providers are replaceable brains/tools, not employee identities.
- Official APIs and local models are preferred for stable structured execution.
- Consumer-app automation must be isolated behind provider-specific adapters and used only where technically and contractually appropriate.
- No credentials, account passwords, tokens or private Owner data may be committed.

## Acceptance gates
- TypeScript domain model compiles under strict mode.
- Unit tests cover hierarchy, node heartbeat, idempotency, capability scheduling, bounded retry/reassignment and independence.
- Integration test proves two primary employees execute concurrently and a different employee reviews the combined result; Judge is also independent when required.
- Existing repository CI remains PASS.
- No Tiger IQ Driver mutation, no PC01 runtime mutation, no billing/provider activation.
- Branch may merge only after exact-head CI/gates PASS.

## Next phases after P0
- Persistent workforce store + status API + mobile Workforce Board.
- Android Worker APK buildable MVP and secure pairing endpoint.
- Farm Gateway adapter for ADB/Appium/device inventory.
- Two-phone real-device gate.
- Department planner, performance routing and scale test at 5/10/20 workers.
