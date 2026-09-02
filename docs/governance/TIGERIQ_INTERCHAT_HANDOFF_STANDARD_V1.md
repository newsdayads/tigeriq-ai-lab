# TIGERIQ — INTER-CHAT HANDOFF STANDARD V1

Status: ACTIVE DESIGN RULE under WO-049; OFF MAIN/Production until approved/merged.

## Owner communication rule
Whenever the Owner is asked to move work to another TigerIQ chat, the handoff shown to the Owner MUST be concise and copyable.

Required visible format:

```text
CHAT XX — <one imperative instruction referencing the authoritative Issue/PR/WO>.
```

Example:

```text
CHAT 05 — Thực hiện Issue #145 theo đúng Source of Truth TigerIQ.
```

Rules:
1. The handoff itself is exactly one line.
2. Put the target chat in the same line.
3. Reference the authoritative Issue/PR/WO instead of repeating its full contents.
4. Do not restate background, scope, acceptance criteria, Source of Truth, or technical rationale already recorded in the work item.
5. The receiving chat must read the referenced work item and current Source of Truth before acting.
6. If more context is required, update the authoritative Issue/PR/WO first; do not expand the Owner handoff prompt.
7. No multi-paragraph transfer prompt unless the Owner explicitly requests one.
8. This presentation rule does not weaken technical gates, exact-head verification, evidence requirements, scope ownership, or MAIN/Production controls.
