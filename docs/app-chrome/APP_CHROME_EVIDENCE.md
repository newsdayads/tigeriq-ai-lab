# APP CHROME — EVIDENCE V1
Authority issue: #1940
Mode: append-only evidence log; corrections must preserve prior entry and add a superseding entry.

## E0 — Owner authorization
- Token: `DUYỆT APP_CHROME_RECOVERY_V1`
- Scope: 5-file lock + audit + fix + tests + reboot + branch/PR/check/review/merge/rollout within App Chrome recovery.

## E1 — Pre-recovery live baseline
Observed PC01 before recovery mutation:
- active deploy: `D:\TigerIQ\Apps\ChromeController\Deploy-final-ede7348`
- exact head: `ede7348d6d21cbad9d8b2afc92e8cd776c78fbdf`
- 3 windows open with fresh heartbeat.
- NV02 READY with `pendingContinue=false`; continuity effectively idle without assignment.
- NV03/NV04 READY with long Core/GitHub role-fallback/self-claim prompts in continuity state.
- NV02/NV03 model detector blocked at that observation; NV04 model verified.

Interpretation:
- transport/CDP/window liveness exists;
- behavior conflicts with locked SPEC because continuity depends on assignment/fallback architecture.

## E2 — Canonical source baseline
GitHub main at start of recovery:
`dc286c23581d7c233004fe1bcde424c1cdea3d52`.

Relevant current source confirms:
- `apps/chrome-controller/extension/continuity.js` contains 21 local continue prompts but special-cases NV02/NV03/NV04 into long Core/GitHub role fallback prompts.
- `apps/chrome-controller/direct-cdp-bridge.mjs` gates NV02 non-WORKING continuity on `currentWorkerAssignmentStatus('NV02')` and returns when not `CONTINUABLE`.
- generic NV03/NV04 continuity also consults assignment state.
- interrupted-response path suppresses continue when assignment is not CONTINUABLE.

This is the starting root-cause evidence for STEP 3.