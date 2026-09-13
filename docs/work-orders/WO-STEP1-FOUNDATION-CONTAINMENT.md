# Step 1: foundation containment

Status: OFF-MAIN IMPLEMENTATION. Owner approval is required before merge or runtime rollout.
Base: 548ea9a842f95a543107e2e9a70d0995492edfba.
One migration PR only. No paid services, credential changes, new framework, retry layer, or auditor.

## Scope
KEEP: Core health/status, read-only Web Control, PostgreSQL/history, explicit research/probe endpoints,
existing workforce/device functionality, independent review, CI and privileged release approval.
DISABLE: both automatic GitHub intakes, Core manager/job draining/recovery/self-check,
Coding Lane entry/direct worker/auto-merge/autonomy supervisor, Windows lane launcher/installer/revival.
REMOVE-LATER: unreachable legacy coding/transport/repair code and obsolete UI/controller paths, after consumer audit.
REPLACE: test discovery gaps with existing Vitest plus Node test runners; placeholder E2E with browser checks.
Codex product pilot and final routing cutover are NOT part of this PR.

## Acceptance
- Entry/direct lane invocation exits without DB, provider, GitHub writes or timers, regardless of legacy env flags.
- Core fails without DATABASE_URL; boots with disposable PostgreSQL and remains readable.
- Old nonterminal Core/Coding rows are copied exactly once into tigeriq_legacy_quarantine then blocked,
  in one transaction with a persistent one-time migration marker. New research rows are not swept on restart. Completed rows and original payloads survive. Repeated restart cannot replay work.
- No manager/self-check/job execution resumes while containment policy is installed.
- Web remains healthy and usable on desktop/mobile with Coding Lane intentionally disabled.
- All tests/**/*.test.mjs at the current repository root are run by their existing runner.
- Runtime .mjs/.js and inline browser scripts are syntax checked; PowerShell scripts are parsed recursively.
- Every required workflow checks out and prints its exact tested SHA. Runtime updater requires an explicitly
  approved release SHA and successful latest workflows for THAT SHA; historical PR-head success is insufficient.
- Failures are diagnosed using Actions logs/assertions. No autonomous source repair is added.
- Independent reviewer and Judge examine the final PR SHA and CI evidence before off-MAIN acceptance.

## Activation boundary
This PR does not stop or replace live PC01 services. No runtime rollout is authorized in this step.
Its code-side no-replay guarantee applies after the approved version is installed. Do not claim live containment
from an off-MAIN CI pass. Existing live jobs/PRs remain a rollout prerequisite until reconciled.
Do not install a preview over the live database.

## Safe rollout after separate approval
1. Record actual runtime SHA, Scheduled Task states and active job/PR IDs; back up PostgreSQL and verify restore.
2. Pause the old updater first to prevent revival. Stop/disable only the Coding Lane task and verify its exact
   child process is gone. Pause old automatic Core ingress while replacing Core at the approved release boundary.
3. Reconcile each old autonomous PR by issue/job/head SHA: retain its branch/diff; close superseded work WITHOUT
   marking it completed. Preserve issue history. Do not merge any old PR as part of containment.
4. Install the approved runtime artifacts. Core startup transaction snapshots then blocks legacy work.
   Verify quarantine row counts, unchanged completed rows, zero replay after restart, Core/Web health.
5. Resume only Core/Web watchdog coverage. Lane installer/launcher do nothing and updater never restarts it.
   The approved-release SHA parameter prevents unapproved subsequent source rollout.
6. Keep old PRs/job IDs archived; later Codex work starts from a newly approved issue, never automatic replay.

## Rollback
Before rollout: close this PR if rejected; MAIN/runtime/data are unchanged.
After approved rollout: stop the updater and Core/Lane before recovery and preserve current DB.
Do NOT start any pre-containment Core/updater artifact: it can revive intake and replay blocked work.
Rollback only to a separately verified artifact retaining ALL containment guards and the migration marker,
through a separate privileged release. If none exists, remain stopped; reduced availability is safer than replay.
Web-only rollback must retain a compatible execution-policy bundle. Keep Lane task disabled.
Reverting this entire PR is not a safe live rollback.
Do not restore the whole DB over newer data; tigeriq_legacy_quarantine retains exact pre-migration rows.
Never bulk unquarantine or automatically reopen/replay jobs. An approved operator may recover a selected
work item after checking its PR/merge state and deduplication identity.
The additive quarantine table can remain. No down migration or data deletion is required.

## Test corrections
Formerly unexecuted transport test compared HEAD input to unrelated dot characters; it now asserts exact
equality with the original input (stronger preservation check). A stale source regex now matches the actual
waitGates(branch,pr.number) call. Old launcher/auditor/PR-head-fallback assertions are replaced by the
new disabled/no-replay/exact-SHA contract, not suppressed. No Golden expected output is auto-edited.

The invalid-escape fixture now uses \\project instead of \\new: JSON \\n is a valid newline, not an invalid escape.
An additional test preserves valid newline semantics. No path-guessing repair or new retry is introduced.
The schema predicate now returns false (not undefined) for a missing manager job, as its existing assertion requires.

Legacy resource leases are snapshotted and cleared only when linked to the quarantined Core cohort.

## Legacy PR inventory (read-only, before activation)
These are open automated PRs, NOT accepted or replayable work. Retain each branch and job identity.
Close only after old workers/updater are stopped, to avoid supervisor regeneration. Production DB cohort
must be reconciled at that boundary; this inventory is not proof that live jobs are paused.

| PR | Job | Head SHA |
| --- | --- | --- |
| #732 | CODE-370a055c-0c59-4072-815e-38be435775c2 | 80fc19ec600117a489f43d928349a705dbb317eb |
| #720 | CODE-78a11e40-8a88-4d65-8303-848c4c76dcb3 | 4798b31c4a11103c3240a5d8828638c472f21140 |
| #719 | CODE-3c64c87f-0778-45c8-a2a7-cb3aacca4681 | 21b94a083249a423ae276ede1d2b5fc65ac1dbb6 |
| #652 | CODE-eb28a1bf-69e3-4dfa-85e9-406ece48abd3 | cfc443b9151bc221b37fe467d379e2ad1ae7ff68 |
| #648 | CODE-60f9a9a9-6ee7-49c4-aca8-a42d646cd09c | 63cd8cfb32d6f2d5d1cf40526c246118708e8e8d |
| #646 | CODE-e37b3593-7e37-4db9-bbe7-d75a1e484f2e | 60083273e111cbe052972bd61425c3d4b75910b7 |
