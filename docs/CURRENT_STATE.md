# TigerIQ — Current State

Date: 2026-09-26
Status: CURRENT — GitHub canonical state reconciled at 2026-09-26T03:57Z; live runtime facts below are explicitly timestamped and historical sections remain provenance only
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 + Registry #335 + Interaction Policy #504 > this snapshot. Runtime assertions require separately timestamped live evidence.

## Canonical reconciliation — 2026-09-26

Source snapshot:
- GitHub `main` audited at `f486b6f39f5afe5ee82908c204c6bd3261de9ae8` after #1954 merged.
- CENTRAL #280, Registry #335 and Interaction Policy #504 were re-read on 2026-09-26. Current authority includes Remote Boundary / Local Autonomy, Workforce Routing V2, and the VY execution router. App Chrome-specific AC rules remain canonical only inside App Chrome scope and are OUT OF SCOPE for this reconciliation.
- Registry #335 root is `REGISTRY_ROOT_VERSION=53`; older v52 wording below is historical.
- Engineering remains branch → PR → exact-head checks → review/authorized waiver → merge; direct `main` mutation is forbidden.

Autonomy / routing closeout:
- #1959, #1955, #1935, #1915, #1916 and #1945 are CLOSED/COMPLETED.
- #1951, #1961, #1958 and #1954 are CLOSED/COMPLETED after their scoped fixes merged.
- #1916 runtime E2E PASS: eligible #1935 was materialized and auto-routed to NV06/OpenClaw, completed, released its lease/resource, then dependent #1922 was auto-claimed and completed by NV09 with `NV09_CORE_DIRECT_OK`. #1915 then closed DONE.
- #1935 has durable Core objective/job completion evidence through NV06/OpenClaw. The current GitHub outcome formatter does not echo the raw updater file payload fields; those individual field values are therefore not asserted here.
- #1948 remains OPEN until this docs reconciliation itself passes exact-head gates and merges. Parent #1947 remains OPEN until its final reconciliation is recorded.
- #1806 is OPEN with `CURRENT_STATE=NEEDS_REBASE_BEFORE_REVIEW`; the older claim below that #1806 was CLOSED is stale and historical.

Live runtime snapshot:
- PC01 live-status generated at `2026-09-26T03:57:06.462Z` reported Core=true, Coding=true, UI Autopilot=true.
- At that instant NV09 was WORKING on `qwen3-coder:30b`; NV06 and NV10 were IDLE; API resources had mixed live health/rate-limit states. These are point-in-time runtime facts, not durable identity changes.
- No App Chrome source/runtime/config/controller/Worker Utility mutation was performed by the #1947/#1948 work described here.

Historical provenance notice:
- Sections below that carry 2026-09-18 / 2026-09-20 / 2026-09-24 runtime dates remain historical evidence. They must not be interpreted as current heartbeat/liveness assertions unless independently reverified.

## Canonical source / runtime
- GitHub `main` remains canonical. Engineering changes go `branch → PR → required checks → merge`; no direct `main`.
- #763 Chrome autonomy hardening remains source/runtime verified after PR #798 and PR #799 merged.
- Chrome Controller `127.0.0.1:8798` and Direct CDP Bridge `127.0.0.1:8799` are ONLINE; existing Chrome sessions are preserved.
- UI Autopilot Snapshot Adapter `127.0.0.1:8794` remains on snapshot v2; latest verified queue revision remains `github-ui-v2:GH-797:DONE:none:none`.
- TigerIQ Core `100.97.23.87:8795`, Web Control `100.97.23.87:8796`, and Coding Lane `8797` remain canonical service identities. Core serves as the authoritative work lifecycle. Latest durable runtime checkpoint in #788 (2026-09-20T07:03:46Z) recorded Core/Web/Coding healthy and Coding Lane restarted; #1714 restart continuity verified; this docs-only reconciliation does not assert a newer live heartbeat.

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
- Workforce authority is GitHub Issue #335. Current canonical registry root is version 53; the prior live v52 observation is historical.
- `NV02 = ChatGPT Plus`; `NV03 = ChatGPT Go`; `NV04 = Gemini Pro`; `NV10 = Ollama`.
- `GPT-6 Astra` remains an on-demand high-tier resource of NV02, not a separate employee.

## Scheduler & Runtime Updates
- #843 scheduler-starvation fix successfully implemented and verified, resolving queue starvation under high load.

## Historical GitHub reconciliation — 2026-09-20
- #937, #941, #926, #922, #924 and #962 are CLOSED in GitHub; older CENTRAL wording that listed them as OPEN is stale.
- #1001 is CLOSED/COMPLETED and its scope-aware Coding Adapter acceptance was recorded PASS.
- #1032 is CLOSED as duplicate; #1033 is CLOSED/COMPLETED; #1201 is CLOSED/COMPLETED.
- #1002 remains OPEN with declared dependencies #1032/#1033/#1038; because #1032 and #1033 are terminal, #1038 is the remaining open declared blocker.
- #1122 is OPEN/reopened as the canonical NV02 continuous-execution baseline and carries NV02 self-modification protection.
- #1038 and #1161 remain OPEN under NV02 self-modification/Chrome overlap guards; safe evidence-hygiene lanes must not mutate those scopes.
- #1176 remains OPEN as a manually assigned, evidence-only hygiene lane; it forbids code/runtime/Chrome/Worker Utility mutation.
- #658 remains OPEN pending real autonomous browser-cycle evidence. #773 remains OPEN because its temporary branch still exists and cleanup requires a separate mutation-authorized lane.

## Unified Control Plane closeout evidence — 2026-09-24
- Core is the authoritative executable-work lifecycle; Coding Lane and Chrome Controller remain executors/adapters rather than competing work authorities.
- A / UI-read-review: #1766 is CLOSED/COMPLETED with durable NV02 post-fix dispatch/F5-guard evidence; later Core readback reconciled GH-1766 to DONE and READY_UNASSIGNED without terminal resurrection.
- B / repository coding: #1687 records live Coding Lane acceptance with PR #1807 and PR #1809 merged after exact-head checks and independent review. #1812 adds fresh same-job bounded failover evidence: MGR-OBJ-GH-1812 failed on NV11 HTTP_429, rerouted to NV12, then completed the same objective.
- C / restart continuity: #1714 is CLOSED/COMPLETED; JOB-GH-1714-PC survived a controlled Core restart, finished DONE, retained one durable dispatch record, and reported no duplicate tool execution.
- Workforce authority remains Registry #335; Core live workforce metadata reported registry version 52. CENTRAL #280 remains the current queue/router authority.
- #1811/#993 closeout evidence is assembled for final parent reconciliation; terminal parent state remains authoritative in the GitHub issues rather than this snapshot.

## Governance

### Authorization boundary migration — #1967
- Owner explicitly authorized the TigerIQ-wide authorization migration, including Remote Guard security-boundary changes.
- Target model: **Remote Boundary, Local Autonomy**. Remote Desktop Guard protects only calls traversing Remote Desktop Commander/CMD into PC01; it is not a global employee permission system.
- Every RDC mutation remains default-deny and uses the exact bounded one-shot Owner authorization contract from #1907. No employee/model identity bypass is allowed.
- Native/local/API/GitHub execution is authorized by assignment + capability + RESOURCE_SCOPE with one active mutation owner per resource. Safe/reversible/zero-cost assigned work does not require repeated Owner approval.
- Permanent static employee locks, including the App Chrome Owner+Vy-only mutation lock, are superseded for routine safe work by scoped one-writer ownership. App Chrome remains UI continuity/transport only; its behavior/spec is otherwise unchanged.
- Hard gates remain Owner-controlled: security/Guard/permission changes, credentials/secrets, Production, paid/financial, destructive/irreversible.
- Canonical design: docs/ADR/ADR-REMOTE-BOUNDARY-LOCAL-AUTONOMY.md. Migration is not complete until exact-head checks, independent review, merge and live canary verify both local/native continuity and the RDC deny boundary.

## Issue Updates — reconciled 2026-09-26
- #1915: CLOSED/COMPLETED — NV09 Coding Lane activation and live canary acceptance satisfied.
- #1916: CLOSED/COMPLETED — Core backlog auto-dispatch/runtime recovery E2E verified.
- #1935: CLOSED/COMPLETED — bounded Core → NV06/OpenClaw pc_operator execution completed.
- #1945: CLOSED/COMPLETED — Core auto-route OpenClaw → tigeriq_pc canary completed.
- #1951: CLOSED/COMPLETED — P0 Owner marker semantics corrected.
- #1954: CLOSED/COMPLETED — bounded live GitHub context added to Coding Lane with stale-context fail-closed behavior.
- #1955: CLOSED/COMPLETED — stale Coding result/source revision guard.
- #1958: CLOSED/COMPLETED — bounded explicit `CONTEXT_ISSUES` hydration added.
- #1959: CLOSED/COMPLETED — critical autonomy regression tests are discovered by CI.
- #1960: CLOSED/COMPLETED — durable exact-head review gate V2.
- #1961: CLOSED/COMPLETED — Coding Lane rechecks canonical source Work Order before mutation/merge.
- #1806: OPEN — `CURRENT_STATE=NEEDS_REBASE_BEFORE_REVIEW`; prior CLOSED wording was stale.
- #1946: CLOSED — registry version bump to 53 remains historical provenance.
- Interaction #504 remains canonical interaction policy alongside current Owner overrides; scoped Owner instructions may supersede lower-priority delegation wording without bypassing hard gates.
- Production, paid/financial, credential/secret, security/permission-boundary and destructive/irreversible actions remain separate hard gates.
- App Chrome is OUT OF SCOPE for this #1948 reconciliation; historical App Chrome/Worker Utility evidence below is not changed.

## #1003 Runtime Source Isolation Closeout
- Implemented dedicated clean source checkout mechanisms for runtime isolation under `scripts/tigeriq-core/` and `apps/tigeriq-core/` satisfying 3x E2E closeout requirements.
- Verified full isolation compliance across all 3x E2E verification cycles.

STATE: `CURRENT_20260926_AUTONOMY_ROUTING_RECONCILED`
UI_STATE: `CORE_UI_GH1766_DONE_READY_UNASSIGNED_20260924`
