# P0 #4902 — G6 Vy: isolated integration and Owner audit packet

Marker: `P0_HANDOFF_G6_READY_FOR_OWNER_AUDIT` (handoff for review, **not acceptance**).
Status: `G6_SOURCE_READY_FOR_OWNER_AUDIT | G6_RUNTIME_E2E_BLOCKED | DONE=false`.
Scope: `p0/owner-vy-core-coding-contract-20261016` / draft PR #4898 only.

## Authority / unchanged acceptance
- G1/G2/G4 = **3/6 accepted** on Issue #4902; G4 actual disposable PostgreSQL 11/11 PASS at source `2d9197bc2d47be920b96eba7eb256a657da389c4`, original proof: https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38835675703/job/116764146984 .
- This change does **not** modify any of Work G3's five files or Antigravity G5's three files, or production/PC01/main. Do not reuse a green CI of a prior SHA as the new HEAD result.
- G3 PR #4911 current source pending source/model/tool verification and exact-HEAD CI; G5 PR #4912 `fd50aa2647dce7a26924de58b974f14af0a19d7e` still has receipt-provenance defects, including inference of success from `status=completed` without actual conclusion. Do not integrate until owner of that scope resolves issues with test and CI proof.

## G6 implementation (source only)
1. Manager builds canonical Work Order, pinned allowed files, material-source fingerprint and step packet; packet includes Skill proof (ID/version/bytes/content context), source SHA, tests and acceptance criteria.
2. Implementer executes a bounded coding job. Atomic PostgreSQL source-claim/replay guard prevents file scope overlap, aliases, repeat failure and legacy history bypass.
3. Review: independent reviewer must be different from implementer and bound to exact HEAD. The canonical scoped Owner waiver is accepted as `OWNER_WAIVED_NOT_INDEPENDENT_PASS`, never treated as product PASS. Review rework must produce fresh CI and review.
4. GitHub provider check: G6 caller (not AI text) requests REST check runs by the exact PR HEAD; validates provider, repository, source SHA, check-run ID, run URL, `github-actions` App, `completed/success`, required domain check and complete page. Duplicated matching failing runs block acceptance. The check evidence is not a user-supplied array.
5. Source proof: fetch changed files from GitHub at the exact source SHA and verify Git blob SHA-1 over real UTF-8 bytes using the `blob <length>\\0` header. Empty or unverifiable content is blocked. Modified paths must stay within the canonical step.
6. Product acceptor: G6 delegates only after verified GitHub inputs to independently maintained G5 product acceptance. If G5 module is absent, return `CODING_G5_PRODUCT_ACCEPTOR_UNAVAILABLE`; never substitute mock generic CI or waiver. No `receipts` from AI are passed to G5.
7. Acceptor is a technical gate, **not** a production release permit. On absent verified product evidence the job must not be marked accepted. No automatic main merge or PC01 deployment.

## Isolated test matrix
- Deterministic: `tests/coding-p0-g6-isolated-workflow.test.mjs` through default npm test. Manager packet → real Skill loader content in local checkout → role prompts → coder change → review/rework and waiver policies → GitHub provider mock → product acceptor mock; duplicate/retry, source alias, unknown legacy, failover budget, stale-head review, restart orphan and active lease, missing required bytes and SHA mismatch, checks provenance and negative spoof cases.
- PostgreSQL real **G4 only**, distinct from G6 AI integration: `tests/run-postgres-isolated-ci.mjs`, uses disposable GitHub hosted runner database and peer role, explicitly removes both after test. No shared Production DB.
- This source CI cannot establish that a real model performed one coding step with a verified tool, real independent AI reviewed it, Android/frontend/backend app genuinely built and was accepted, or PC01 actually ran the changed code. It proves contracts, isolated integrations and CI build only.
- Evidence of exact HEAD CI (CI Verify / Queue Hygiene / Vercel) must be recorded on PR #4898 and Issue #4902 **after the final commit**. Do not copy an old SHA into a new acceptance receipt.

## Fail-closed and blockers
- `G3_REAL_MODEL_TOOL_CANARY_NOT_VERIFIED`: no verified real model/tool execution/runner receipt with model ID, permissions, tool output, content proof on the current Scope.
- `G5_PROVENANCE_UNRESOLVED`: PR #4912 lacks validated receipt runner origin and allows inferred conclusion; G5 not integrated.
- `G6_REAL_WORKER_E2E_NOT_VERIFIED`: no protected authorized multi-role worker+provider live canary; isolated mocks are not an operational trial.
- `PC01_RELEASE_NOT_PERFORMED`: the current draft candidate has not been merged or installed.
- Accordingly `PROGRESS_COMPLETED=3`, `PROGRESS_TOTAL=6`, `DONE=false`.

## Rollback / audit procedure
1. Before any release, snapshot draft PR #4898 exact HEAD, the true `main` SHA, and PC01 read-only installed SHA. Keep G3/G5 disjoint sources and existing G4 acceptance intact.
2. Source-only rollback: use scoped `git revert` of Vy's G6 commits on the **same isolated branch**, preserving any accepted independent G3/G5 blobs; verify exact branch SHA and rerun required CI. Never force-push, overwrite Work or Antigravity, or reset main.
3. Post-approval activation only: default canary OFF. If an authorized deployment later fails, disable only the scoped canary, fence the target writer/lease, preserve transaction and job receipts, restore previous **approved** runtime through the existing protected release/rollback mechanism, read back installed SHA and service health. No manual production SQL repair or bypass.
4. Never equate a GitHub comment with a Core lease or a device acceptance receipt.

**NEXT_ACTION:** Verify newest Work G3 and Antigravity G5 changes separately. Wait for new, independently auditable receipts and exact-HEAD CI; then selective integrate permitted blobs and run a real authorized G6 multi-step canary and rollback. Present final gate to Owner only after all G3/G5/G6 acceptance is demonstrated.

`DRIVE_SYNC=NOT_REQUIRED`: no Loader/bootstrap edits, draft branch only.
