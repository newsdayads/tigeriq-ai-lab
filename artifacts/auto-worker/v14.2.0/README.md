# TigerIQ Auto Worker V14.2.x — clean successor

Status: OFF-MAIN candidate source. Baseline authority: #306 V13.4.10. Dynamic command/employee authority: CENTRAL #280 + Registry #335. Activation gate: #440. P0 implementation tracker: #441.

## Scope of this successor delta
This directory reconstructs only the V14.2 delta that was present in the released/yielded checkpoint; it does not rebuild V13.4.10 completed behavior.

- pre-activation background set is exactly NV02/Khoa;
- command `2` resolves Khoa and carries the CENTRAL dynamic queue reference;
- command `4` resolves Khải as specialized/non-background with no managed window pre-activation;
- command `5` fails closed as `COMMAND_PENDING_ACTIVATION` before Owner activation;
- stale experimental NV04/NV05 background elevation is reset by authority migration v2;
- post-activation is gated by an explicit #440 Owner token and then opens exactly NV02/NV04/NV05;
- managed placement is 504x834, Top5/Right5, exact 5px inter-window gap using `order * (width + gap)` and real work-area fit checks;
- expected/archive/stop/user close never enters crash recovery; crash recovery alone is bounded at 5s/15s;
- leases, restart WAITING recovery, NV01 preempt/yield, resource governor, near-empty refill, reviewer routing and Archive-before-close fail-closed remain represented in the core contract;
- work routing uses registry resource keys; it does not infer ownership from title text or hardcode a P0 issue.

## Verification boundary
Repository/static verification can prove source semantics and CI. It cannot prove Chrome/PC01 behavior. Physical acceptance remains `PHYSICAL PENDING` until live update/reload, no-reopen observation, real placement, Archive, `2/4/5` routing, restart/crash/lease/governor and NV01 preempt/yield are observed on PC01.

The checkpoint-reported local V14.2 installer/runtime bytes are not present in GitHub, only their hashes are. Therefore no replacement `.cmd` is published from this reconstructed source until the real extension payload is recovered or equivalently machine-tested; this prevents a fabricated installer from being presented as tested evidence.
