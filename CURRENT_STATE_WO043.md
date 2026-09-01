# CURRENT STATE — WO-043 AI COORDINATOR

Date: 2026-09-01
Status: THREE-WAY INDEPENDENCE REMEDIATED — EXACT-HEAD REGATE REQUIRED
Branch: `wo043/ai-coordinator`
PR: #111
Issue: #110

## Working capability in WO-043 scope
- Work item carries kind/risk/acceptance criteria.
- Coordinator chooses the lowest-cost configured model that still meets the required quality profile.
- Runtime provider failures fall through to another eligible model with a bounded attempt count.
- Completed stages are checkpointed so a process restart resumes from persisted progress.
- Every attempt records role, provider/model identity, outcome and failure class.
- Exported evidence omits raw prompt/output and uses output digest.
- Reviewer cannot use Executor model identity.
- Judge cannot use either Executor or Reviewer model identity.
- Every coordinated work item now requires three distinct Executor/Reviewer/Judge provider-model identities and fails closed if a third identity is unavailable.

## 2026-09-01 correction
Current Owner instruction requires `AI làm -> AI khác kiểm tra -> AI thứ ba phán quyết` for all coordinated work. The prior implementation only enforced three-way separation for coding/high-risk work, allowing Reviewer and Judge reuse for lower-risk work.

Remediation applied:
- Judge exclusion now always contains both prior concrete provider/model identities.
- Unit coverage now proves three-way separation for low-risk/general work, restart recovery and evidence flow.
- Low-risk/general work with only two eligible identities now blocks rather than reusing Reviewer as Judge.

Implementation/test head `f7fb806544134e443212729491cb2ff24930b956` passed:
- CI `33532040523` — PASS.
- Queue Hygiene `33532040524` — PASS.
- Vercel Online Verify `33532040600` — PASS.

Documentation commits after that implementation head require a fresh exact-head gate before PASS can be restored.

## Cross-stream boundary retained
- `scripts/pc-worker/worker-github-queue.py` remains restored to MAIN content; WO-043 does not own PC01 runtime.
- PC01 recovery/security remains delegated to #114/#116.
- Runtime zero-cost provider policy/probe remains governed by #133/#134.

## Not claimed / not changed
- No App UI change.
- No Web Control UI change.
- No PC01 runtime implementation owned by WO-043.
- No MAIN/Production merge or deployment.
- No paid-provider activation or purchase.
- No new secret/token in source control.
- No live three-provider semantic review claim.
- No new independent exact-head review claim after the 2026-09-01 change.

## Current next gate
1. Fresh exact-head CI, Queue Hygiene and Vercel Verify after documentation synchronization.
2. Genuinely independent exact-head review; same-author/self-review is not accepted as independent evidence.
3. Only then can WO-043 return to repository PASS candidate; merge still requires normal release authorization.
