# WO-059 — Authorization Engine V1

Date: 2026-09-03
Status: REPOSITORY GATE PASS — PHYSICAL PC01 E2E PENDING
Branch: `wo059/authorization-engine-v1`
Base: `wo058/autonomous-planner-v1`
MAIN/Production: untouched
OpenClaw dependency: none
Repository gate: GitHub Actions run `33739656364` PASS

## Objective
Replace the WO-058 boolean authorization hold with a deterministic fail-closed policy layer that lets PC01 run safe work autonomously while holding higher-risk work until explicit scoped Owner authorization exists.

## Policy model
Action classes are mapped to three risk levels:
- GREEN: local/reversible execution such as local AI, workspace read/write, feature-branch work, test/build and local read-only control. These may auto-dispatch.
- YELLOW: local control writes, script execution and external-write class actions. These require an exact active Owner grant scoped to task + action class.
- RED: MAIN/Production, financial, security-sensitive, destructive and irreversible classes. These fail closed without an exact active Owner grant and are never silently inferred as authorized.

Unknown/unclassifiable actions fail closed as RED-equivalent held authorization. A task cannot declare a lower-risk class than the class inferred from its actual route/tool request (`POLICY_DOWNGRADE_DENIED`).

## Authorization store
Runtime file: `F:\TigerIQ\Runtime\autonomous-planner-v1\authorizations.json`

Grant contract:
- unique `grantId`;
- exact `taskId`;
- exact `actionClass`;
- `approvedBy=OWNER`;
- valid issued/expiry window;
- non-revoked.

Expired, revoked, wrong-task, wrong-class or non-Owner grants do not release work.

## Runtime integration
- Planner loads and validates the authorization store every cycle.
- Policy decision is persisted in planner state per task with action class, risk level, decision, reason and optional grant ID.
- Held YELLOW/RED work does not create Controller Work Orders.
- Independent GREEN work continues while other tasks remain held.
- Existing protected-branch/path/tool allowlists remain in force; this policy layer does not weaken WO-057/WO-058 execution boundaries.

## Repository acceptance — PASS
GitHub Actions run `33739656364` completed successfully.
- Linux: npm ci, typecheck, unit tests, build, authorization safety contract PASS.
- Windows: npm ci, typecheck, unit tests, build, planner/policy build artifacts and PowerShell parser PASS.

## Physical acceptance — PENDING
Prepared script: `scripts/pc01-autonomy/Invoke-WO059-Physical-E2E.ps1`.

Physical E2E injects five isolated tasks with unique IDs:
1. GREEN workspace write → must auto-dispatch and create artifact.
2. YELLOW task without grant → must remain held, no Controller job, no artifact.
3. YELLOW task with exact active OWNER grant → must dispatch and complete.
4. RED financial-class task without grant → must remain held, no Controller job, no artifact.
5. Independent GREEN task → must complete despite held YELLOW/RED work.

PASS also requires Controller/PostgreSQL/PC01 Native Worker healthy after the test, machine-readable evidence under `docs/evidence/WO-059-AUTHORIZATION-ENGINE-E2E-<timestamp>.json`, MAIN/Production untouched, no financial/security-sensitive action executed and no secret printed.

## Boundary
WO-059 controls authorization of explicit backlog tasks. Natural-language mission decomposition remains outside this Work Order and is the next autonomy layer after WO-059 is physically verified.
