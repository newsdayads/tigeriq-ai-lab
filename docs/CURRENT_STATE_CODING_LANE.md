# TigerIQ — Coding Lane Pending State

Date: 2026-09-12
Status: PENDING E2E

- Autonomous Coding Lane source is isolated on `vy/coding-lane-autonomy-20260912`.
- Runtime target is a separate service on port `8797`; Core/API Health `8795` remains untouched during rollout.
- Coding work uses isolated GitHub branches and never writes directly to `main`.
- Manager → coding queue → API implementer → PR → required CI → independent API reviewer → revise/retest → guarded merge.
- Official runtime is free-only/fail-closed for API usage.
- Runtime updater change is path-aware so Web Control/Coding Lane changes do not restart Core.
- Final activation waits for CI + PC01 sidecar E2E + exact governance evidence.
