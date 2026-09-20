# TigerIQ — Current State

Date: 2026-09-20
Status: CURRENT — GitHub state reconciled on 2026-09-20; runtime facts are cited to durable checkpoints and are not treated as a fresh live probe
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical source / runtime
- GitHub `main` remains canonical. Engineering changes go `branch → PR → required checks → merge`; no direct `main`.
- #763 Chrome autonomy hardening remains source/runtime verified after PR #798 and PR #799 merged.
- Chrome Controller `127.0.0.1:8798` and Direct CDP Bridge `127.0.0.1:8799` are ONLINE; existing Chrome sessions are preserved.
- UI Autopilot Snapshot Adapter `127.0.0.1:8794` remains on snapshot v2; latest verified queue revision remains `github-ui-v2:GH-797:DONE:none:none`.
- TigerIQ Core `100.97.23.87:8795`, Web Control `100.97.23.87:8796`, and Coding Lane `8797` remain canonical service identities. Latest durable runtime checkpoint in #788 (2026-09-20T07:03:46Z) recorded Core/Web/Coding healthy and Coding Lane restarted; this docs-only reconciliation does not assert a newer live heartbeat.

## #763 — Chrome autonomy final truth
- PR #798 merged: `AUTO_CONTINUE` keeps the current worker chat (`navigate=false`).
- PR #799 merged: explicit known non-delivery can take one bounded safe retry; ambiguous delivery remains fail-closed.
- Canary #796 and #797 completed exactly once; final autopilot evidence has no pending/uncertain job.
- #763 is CLOSED/COMPLETED.

## Astra dispatch / handoff truth
- #833 autonomous handoff PASS verified.
- #787 is CLOSED/COMPLETED.
- `gpt-6-astra` remains an on-demand resource of NV02, not a separate employee.
- Usage/quota remains `UNKNOWN` without a direct measurement source; no percentage is inferred.
- Verified fallback remains Astra read-only output → durable OFF-MAIN handoff → Vy/GitHub application when policy prevents mutation.

## Chrome workforce live truth
- Canonical UI workers remain `NV02 | NV03 | NV04`.
- Live Controller evidence on 2026-09-18 shows all three windows OPEN with fresh heartbeats, no security block, and interactive Session 1.
- `NV03` remains independent review/support; `NV04` remains research/cross-check. No #802 mutation ownership remains active after closeout.

## Worker Utility / #802 final truth
- #793 Worker Utility V1 remains the canonical APP for controlling NV02/NV03/NV04; source is `apps/worker-utility/**`.
- #802 is CLOSED/COMPLETED after source, independent review, deploy and live physical verification.
- PR #813 merged: live Direct-CDP `ARCHIVE_CHAT` runtime path is source-controlled with fail-closed durable-receipt/terminal-DONE guards and credential-preserving deployment.
- PR #814 merged: Worker Utility visual finish — borderless rounded branded shell, TigerIQ navy header, status/health pills, rounded action cards/buttons, dark log console and branded worker badges.
- Live acceptance after #814 exposed one real blocker: `PillLabel.TextChanged` could call `BeginInvoke` before a window handle existed. Runtime was immediately rolled back; no DONE claim was made.
- PR #815 merged at exact head `4fe7dabf097bae2d8553349281ab3b7f9a0439f4`; all four workflows PASS: CI #1824, Worker Utility V1 #34, WO-012/013 #1024, WO-014 #1086.
- NV03 independent review: `REVIEW=PASS`, blocker none, comment `5719487684`.
- GitHub artifact `TigerIQ-WorkerUtility-V1-win-x64` from run `35259990368` was deployed to PC01 interactive Session 1.
- Live runtime path: `D:\TigerIQ\Apps\WorkerUtility\Current-v1-20260918-014616\TigerIQ.WorkerUtility.exe`.
- Live executable SHA256: `9573b000b458926cd7c6da7d727534b8f54790e111154586e579057201f26f05`.
- Live probe evidence: `D:\TigerIQ\Evidence\issue802-ui815-live.json`; screenshot: `D:\TigerIQ\Evidence\issue802-ui815-screen.png`.
- NV02 popup opens successfully at `x=1399..1743`, while NV02 Chrome starts at `x=1753`; 10px gap, no overlap. Three badges NV02/NV03/NV04 are visible and anchored.
- Final live screenshot confirms the branded popup renders normally with no pre-handle exception dialog.

## Workforce / identity
- Registry #335 remains authoritative for employee identity/capability.
- `NV02 = ChatGPT Plus`; `NV03 = ChatGPT Go`; `NV04 = Gemini Pro`; `NV10 = Ollama`.
- `GPT-6 Astra` remains an on-demand high-tier resource of NV02, not a separate employee.

## Scheduler & Runtime Updates
- #843 scheduler-starvation fix successfully implemented and verified, resolving queue starvation under high load.
- #1003 dedicated clean source checkout mechanisms for runtime isolation under scripts/tigeriq-core/ and apps/tigeriq-core/ successfully implemented and verified across 3x E2E closeout runs.

## GitHub reconciliation — 2026-09-20
- #937, #941, #926, #922, #924 and #962 are CLOSED in GitHub; older CENTRAL wording that listed them as OPEN is stale.
- #1001 is CLOSED/COMPLETED and its scope-aware Coding Adapter acceptance was recorded PASS.
- #1032 is CLOSED as duplicate; #1033 is CLOSED/COMPLETED; #1201 is CLOSED/COMPLETED.
- #1002 remains OPEN with declared dependencies #1032/#1033/#1038; because #1032 and #1033 are terminal, #1038 is the remaining open declared blocker.
- #1122 is OPEN/reopened as the canonical NV02 continuous-execution baseline and carries NV02 self-modification protection.
- #1038 and #1161 remain OPEN under NV02 self-modification/Chrome overlap guards; safe evidence-hygiene lanes must not mutate those scopes.
- #1176 remains OPEN as a manually assigned, evidence-only hygiene lane; it forbids code/runtime/Chrome/Worker Utility mutation.
- #658 remains OPEN pending real autonomous browser-cycle evidence. #773 remains OPEN because its temporary branch still exists and cleanup requires a separate mutation-authorized lane.
- Registry #335 is the authority for current workforce/provider identity; do not infer provider identity from stale snapshots in this file.

## Governance
- Interaction #504 remains the generic command policy; explicit Owner instructions can supersede delegation for a scoped Work Order.
- Production/runtime, paid, credential/security and destructive/irreversible actions remain separate authorization gates.
- #802 closeout does not reopen NV02 mutation ownership; any new Worker Utility mutation requires a new Work Order/handoff.

STATE: `CURRENT_20260920_GITHUB_RECONCILED_RUNTIME_NOT_REPROBED`
UI_STATE: `GITHUB_POLICY_1122_ACTIVE_RUNTIME_NOT_REPROBED`
