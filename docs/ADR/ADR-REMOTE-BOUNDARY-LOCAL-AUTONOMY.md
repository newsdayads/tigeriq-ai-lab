# ADR — Remote Boundary, Local Autonomy

Status: Superseded on PC01 by Owner #2441
Owner authorization: #1967, superseded for RDC runtime by #2441 on 2026-09-29
Scope: TigerIQ authorization boundary

## Owner override #2441 — 2026-09-29
Remote Desktop Guard / Mutation Lease is disabled for PC01 Remote Desktop Commander. The launcher sets `TIGERIQ_REMOTE_GUARD_MODE=DISABLED_PASS_THROUGH`, so RDC tools are exposed and dispatched without lease gating. Legacy guard code is retained only as a reversible rollback path.

## Decision
Remote Desktop Guard protects the **remote entry path into PC01**. It is not the global employee authorization system.

### Remote Desktop Commander / CMD — current PC01 override
- `TIGERIQ_REMOTE_GUARD_MODE=DISABLED_PASS_THROUGH` is the active Owner-approved PC01 mode under #2441.
- RDC tools are exposed and dispatched without Mutation Lease / Owner lease gating.
- The previous deny-by-default lease contract from #1907 is retained in source only as a rollback option; it is not active while the pass-through mode is set.
- This override applies to the RDC boundary only and does not itself authorize Production, paid/financial, credential rotation, or destructive business actions.

### Native/local/API/GitHub execution
- Work that does **not** traverse Remote Desktop Commander is not subject to Remote Desktop Guard.
- Authorization for native/local/API/GitHub work is decided by TigerIQ assignment/capability/resource policy.
- Safe, reversible, zero-cost work may continue without repeated Owner approval when the actor has a valid assignment/capability and resource scope.
- One resource scope has at most one active mutation owner. This is a deduplication/isolation rule, not a permanent employee allowlist.

### Hard gates
Owner approval remains mandatory for:
- Guard or security-boundary changes;
- credentials, secrets and API keys;
- Production release;
- paid/financial commitments;
- destructive/irreversible actions;
- permission grants, privilege expansion or security-policy changes.

No actor may self-grant or expand its own authority.

## App Chrome
The permanent Owner+Vy-only mutation lock is superseded by scoped one-writer ownership:
- App Chrome remains UI transport/continuity only; it does not become backlog dispatcher.
- Mutation requires an active assigned App Chrome resource owner under the current Work Order/maintenance scope.
- Other actors remain read/observe for that scope.
- An actor controlled by the component being repaired must not self-modify that controlling mechanism; use an independent repair owner.
- Existing App Chrome behavior/spec requirements remain unchanged unless a separate authorized Work Order changes them.

## Source engineering
GitHub main remains canonical. Repository engineering continues:
branch -> PR -> exact-head checks -> independent review -> merge.
No direct main.

## Threat boundary
The security invariant is **entry-path based**:
- through RDC => Remote Guard applies;
- not through RDC => normal TigerIQ scoped authorization applies.

Local/native execution must not tunnel through RDC to obtain different authorization semantics. Conversely, Remote Guard must not be consulted as a prerequisite for unrelated local/API/GitHub execution.

## Required regression
1. RDC mutation without lease => DENY.
2. Exact Owner-authorized RDC mutation => ALLOW once.
3. Replay/mismatched RDC mutation => DENY.
4. Unknown RDC tool => DENY.
5. Observation path escape => DENY.
6. Safe assigned non-RDC work => not blocked by Remote Guard.
7. Unassigned/out-of-scope workforce mutation => DENY by workforce/resource policy.
8. Self-grant/privilege expansion => DENY.
9. Security/credential/Production/paid/destructive => Owner gate.
10. Revoking/changing active resource owner prevents the prior owner from further mutation.
