# ADR — Remote Boundary, Local Autonomy

Status: Candidate
Owner authorization: #1967
Scope: TigerIQ authorization boundary

## Decision
Remote Desktop Guard protects the **remote entry path into PC01**. It is not the global employee authorization system.

### Remote Desktop Commander / CMD
- Every mutating call that traverses Remote Desktop Commander remains deny-by-default.
- Mutation requires the existing bounded Owner authorization contract from #1907: exact tool + exact arguments + risk class + expiry <= 5 minutes + single use.
- Replay, mismatch, unknown tools, broad security configuration mutation and observation-path escapes remain fail-closed.
- This rule applies regardless of which employee or model initiated the remote request. Actor identity must never create a broad RDC bypass.

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
