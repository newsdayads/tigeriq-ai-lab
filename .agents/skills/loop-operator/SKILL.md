---
name: loop-operator
description: Operate autonomous agent loops safely, detect stalls or repeated identical blockers across 2 consecutive checkpoints, checkpoint state, and switch to the next eligible P1-P5 task.
---

# Loop Operator (Adapted from affaan-m/ECC)

## Mission
Run autonomous loops (Core, Coding Lane, App Chrome NV02/NV03/NV04) with explicit stop/switch conditions, zero infinite retry storms, and durable handoff state across chat rotations.

## Rules
1. Track progress at every dispatch/checkpoint (`assistantSignature`, `error/blocker` signature).
2. If **2 consecutive checkpoints** produce the same blocker (`ERR_BLOCKED_BY_ADMINISTRATOR`, `BLOCKED`, `EXTERNAL_WAIT`, or identical CI failure) without progress:
   - Stop retrying the same step.
   - Write a durable checkpoint with the exact blocker and SHA.
   - Switch to the next independent `P1–P5` task (`NV02 - Chuyển việc khác` / `NV03 - Chuyển việc khác`) or escalate cleanly.
3. On chat rotation (12-turn limit), persist a compact handoff summary (`issue`, `branch/PR`, `SHA`, `lastResultTail`) and inject it into the first prompt of the new chat.
