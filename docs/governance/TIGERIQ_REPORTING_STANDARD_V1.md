# TIGERIQ — REPORTING STANDARD V1
Version: 1.0
Status: Source of Truth candidate
Priority: P0

## Purpose
TigerIQ reporting must let the Owner understand whole-project progress immediately, not force reconstruction from isolated PR, Issue, or department updates.

## Mandatory report structure
Every TigerIQ progress, audit, status, milestone, handoff, or takeover report must show the project-wide picture before narrow task details.

At minimum include:
1. Overall project build progress bar and percentage.
2. Independent-review/readiness progress bar and percentage when applicable.
3. Release/real-operation readiness progress bar and percentage when applicable.
4. A department/workstream table covering active TigerIQ streams (01-07 or the current authoritative set), with percentage, status, and remaining key work.
5. A concise project interpretation: what is done, what is closest to PASS, and what is weakest, blocked, or deferred.
6. The ordered path from the current state to integrated operation/release.
7. Only after the global dashboard, drill down into the specific PR, Issue, component, test, or blocker under discussion.

## Percentage discipline
- Do not present an isolated PR percentage as the overall project percentage.
- Percentages are evidence-based management estimates derived from completed scope, independent gates, integration readiness, real-runtime proof, and release gates.
- Distinguish at least these dimensions when material: build progress, independent readiness, and release/real-operation readiness.
- A green CI run alone does not imply equivalent project completion.

## Visual consistency
Use the same visual language across TigerIQ chats:
- progress bars;
- clear percentages;
- concise icons;
- status labels such as PASS / FAIL / BLOCKED / DEFERRED / IN PROGRESS;
- explicit remaining work;
- global dashboard first, detailed evidence second.

## Cross-chat continuity
This reporting standard applies across new chats, department chats, audit chats, and handoffs. Any AI taking over TigerIQ work must read the Source of Truth and preserve this reporting format unless the Owner explicitly changes it.

## Minimum dashboard example fields
- 🏗️ Overall project build progress
- 🛡️ Independent-review/readiness
- 🚀 Release/real-operation readiness
- 01-07 workstream progress/status table
- Current strongest/weakest areas
- Ordered path to next company-level milestone
- Specific task/PR details afterward

## Governance
This standard changes reporting/management presentation only. It does not authorize MAIN/Production changes, bypass engineering gates, or redefine technical DONE evidence.
