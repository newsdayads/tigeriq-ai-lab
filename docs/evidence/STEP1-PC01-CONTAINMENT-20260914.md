# Step 1 PC01 containment evidence

Date: 2026-09-14 (Asia/Saigon)
Scope: runtime operations explicitly authorized by Owner; no source editing/builds on PC01.
PR: #737 only. Source base: 548ea9a842f95a543107e2e9a70d0995492edfba.
Verified pre-operation PR head: f102d7d17e0bccb061d741e5982d625c4f3bbde7.
CI 34784975815, Queue 34784975816, Vercel Verify 34784975818: success at that head.
This document does not claim MAIN merge, production rollout, reboot or full containment.

## Inventory
- Core: Scheduled Task TigerIQ Core 24x7, boot trigger/restart policy, launcher run-core.ps1,
  parent PID 35156 -> core-entry.mjs PID 5912. KEEP, not stopped.
- Web: TigerIQ Web Control 24x7, boot trigger, bundled launcher, parent PID 41472 -> PID 13976.
  KEEP, not stopped.
- Lane: TigerIQ Coding Lane 24x7, boot trigger, run-coding-lane.ps1 PID 20392 -> coding-entry PID 6852.
  Task now Disabled; launcher and child stopped. The in-process autonomy supervisor stops with its child.
- Updater: TigerIQ Core Runtime Updater, boot trigger/restart policy, initially Disabled; no updater process.
  Remains Disabled. It formerly could revive the Lane; do not enable the old updater.
- Core entry starts both github-intake and github-coding-intake. Core loop owns manager,
  claim/run and self-check. They have no supported independent live pause endpoint on MAIN.
- Additional inactive legacy bundles: Runtime/CodingLaneBundle and Runtime/CoreUpdaterV2.
- RuntimeOverrides includes manual restore/start diagnostic launchers. Five exact launch files were
  backed up and renamed with .disabled; no source repository files were renamed or edited.
- Task actions, matching Windows services/startup commands and WMI CommandLineEventConsumer were inspected;
  no additional matching registered automatic Coding start path was returned.
- PostgreSQL service, Ollama, Desktop Commander, Core/Web and other workloads were not stopped.
  Existing unrelated Ollama review process was deliberately left alone.

## Backup
Local private backup: D:\\TigerIQ\\Backups\\step1-pr737-20260914
Contains Scheduled Task XML, process inventory, State copy, runtime-copy (including actual app/scripts
and legacy Web/Lane/updater bundles), database.dump, database TOC and SHA256 manifest.
5767 files were hashed before the additional launcher snapshots.
Database dump SHA256: 577CBAF3B184321615507103BCA28D6AF52BC9A51D6710C8735767A6012800EA.
pg_dump custom archive succeeded; pg_restore --list and a full SQL extraction to NUL succeeded.
This validates archive readability, not a completed isolated database restore rehearsal.
The initial direct Compress-Archive hit an in-use source file. Canonical backup is runtime-copy,
not the incomplete runtime-artifacts.zip. A checksum self-enumeration error was corrected by
materializing the file list and excluding the output manifest before hashing.
No secrets or database payloads were uploaded to GitHub.

## Operations and assertions
1. Verified updater disabled and no updater process; backed up before disabling Lane.
2. Disabled Lane Scheduled Task. Stop-ScheduledTask removed its launcher but waited on its child.
   Exact PID/path-checked stop removed child 6852. The waiting operator shell was terminated afterwards.
   No Core/Web/service PID was targeted.
3. An attempted quarantine correctly refused while the child still existed; no DB changes from that attempt.
4. With worker gone, one advisory-locked transaction snapshotted and blocked:
   coding jobs 61; coding objectives 55. No row deletion or failure/result/attempt rewriting.
5. Compared all archived job payload fields except intended status: zero mismatches.
   Completed work unchanged: 12 done jobs, 13 completed objectives. No coding leases required clearing.
   Core unchanged: 25 done jobs, 27 completed objectives.
6. At 05:31:29 +07:00, counts remained unchanged; zero coding leases.
   Native Start-ScheduledTask failed with 'The task is disabled.'
7. At 05:30 +07:00, process inventory returned only Core 5912 and Web 13976 in the scoped runtime paths.
   Both health endpoints reported ok=true; Web's coding subhealth reported CODING_TIMEOUT as expected
   with the old Web artifact. This is not presented as an outage of Core/Web.
8. Closed only #732 and #719, without merge, with explicit superseded/not-DONE disposition.
   Retained branches, diffs, history and all product PRs #720/#652/#648/#646 unchanged.

## Disabled auxiliary launchers
Each original was copied to backup/disabled-launchers, then renamed in its own runtime directory:
- RuntimeOverrides/restore-standard-coding.ps1.disabled
- RuntimeOverrides/run-coding-lane-nv11-nv19.ps1.disabled
- RuntimeOverrides/diag-origin-main-lane.ps1.disabled
- Runtime/CoreUpdaterV2/update-core-runtime.ps1.disabled
- Runtime/CodingLaneBundle/scripts/tigeriq-core/run-coding-lane.ps1.disabled
Legacy source/bundles remain retained, not deleted. Manual execution of retained module files is
not made impossible by a task disable; final source guards require the approved artifact.

## Independent boundary assessment
Separate read-only reviewer confirmed MAIN Core's intakes/manager/self-check cannot be independently
disabled without a Core restart/artifact rollout. Quarantine does not disable timers or future ingress.
Do not falsely report full containment or a reboot test. Do not reboot unrelated services to obtain a test.
The required permission is a controlled containment rollout and Core restart; Web can remain available.
No code fix/retest rounds were needed in this continuation; only documentation/evidence are updated.

## Rollback
- No MAIN changes to revert. Keep the Lane and old updater disabled while approval is pending.
- Retain task XML, renamed launchers, runtime-copy and DB snapshot. Never automatically import/enable
  the old Lane/updater tasks or rename launchers back: that would reintroduce autonomous execution.
- An explicitly approved operator may restore selected data using original_row after checking GitHub
  PR/merge state. Never restore the whole old DB over newer records or bulk replay jobs.
- After release, rollback must use an artifact retaining containment guards and the migration marker.
  A pre-containment Core/updater artifact is NOT a safe running rollback.
- #732/#719 can be reopened only with an explicit scope reversal, never by supervisor.
- Pending: isolated restore rehearsal, controlled Core rollout/restart, post-rollout Windows smoke,
  no-revival observation and final independent release evidence. No pilot issue before those gates.
