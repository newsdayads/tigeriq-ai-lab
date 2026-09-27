# NV02 local GitHub self-pull checkpoint

Contract: `NV02_LOCAL_GITHUB_SELF_PULL=P1_P5_ONLY`.

- Command `02`: active `CURRENT_WORK_ORDER` + checkpoint resumes; terminal/no-current enters local self-pull; no candidate returns `READY_NO_ELIGIBLE_WORK`.
- Candidate gate: P1–P5, `TIGERIQ_EXECUTABLE=true`, not `AUTO_QUEUE=EXCLUDED`, not `OWNER_HOLD`, dependencies complete, NV02 `general|reasoning|ui` capability, and unheld `RESOURCE_SCOPE`.
- P0 is rejected before selection/claim. Core `roleCanPull` remains false for NV02/NV03/NV04. App Chrome remains transport/continuity only; its legacy self-run scheduler remains disabled.
- Lease protocol is claim → evidence → release; the selection/claim helpers are covered by `tests/nv02-local-self-pull.test.mjs`.

Verification checkpoint: `npm run typecheck` PASS; `npm test` PASS (82 files, 778 tests).
