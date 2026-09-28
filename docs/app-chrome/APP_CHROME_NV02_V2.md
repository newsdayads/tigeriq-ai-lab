# App Chrome NV02 V2

Status: Owner-approved implementation specification
Authority: Owner authorization in #2259
Resource scope: APP_CHROME_NV02_V2

## Boundary

- App Chrome controls only the local Chrome/UI continuity of ChatGPT Plus (NV02 - thực thi chính).
- App Chrome does not select GitHub backlog, decide a Work Order, claim resource scope, or dispatch a selected issue.
- ChatGPT Plus (NV02 - thực thi chính) reads the full canonical P1-P5 Work Order set, resumes its own active lease first, then evaluates all remaining P1-P5 before concluding idle.
- `CAPABILITY` is routing metadata, not a pre-filter that hides work from NV02: NV02 either executes an allowed scope directly or coordinates/handoffs to the appropriate specialist without stealing that specialist's mutation/review ownership.
- `coding`, `pc_operator`/device work, and `review` remain visible to NV02. Independent review must stay independent, and NV02 must not self-review work it implemented.
- NV02 excludes P0/hard-gates, App Chrome self-maintenance, HOLD, unsatisfied dependencies, active owner/lease/resource-scope conflicts, and work with no valid direct or handoff execution path.
- P0 is Owner-only. Core does not assign, route, claim, revoke, or heartbeat-gate NV02.
- ChatGPT Go (NV03 - kiểm tra độc lập) and Gemini Pro (NV04 - nghiên cứu sâu và kiểm tra chéo) remain paused and outside this rollout.

## Continuity

- WORKING: do not send.
- READY with ongoing work: send exactly one non-repeating Owner-approved short continue prompt.
- No active work: App Chrome may send one generic bounded idle wake every 5-10 minutes. The wake never identifies or selects an issue; NV02 evaluates the full P1-P5 set, then applies dependency/HOLD/owner/resource-scope/hard-gate checks and chooses direct execution versus specialist handoff.
- `READY_NO_ELIGIBLE_WORK` is valid only when no P1-P5 Work Order can be directly executed or validly coordinated/handoff by NV02.
- READY_NO_ELIGIBLE_WORK arms durable idle state and suppresses normal continue prompts until the next bounded wake.
- F5 is independently randomized between 5 and 10 minutes and never selects work.
- Planned reset remains randomized between 2 and 4 hours and must checkpoint/save before archive or restart.
- Recovery is bounded and must fail closed on security, authentication, ambiguous delivery, lease conflict, or stale identity.

## Runtime security

- The App Chrome controller receives no GitHub credential in NV02 V2.
- Legacy APP_CHROME_SELF_RUN backlog scanning/claiming is disabled.
- Source engineering is GitHub branch to PR to exact-head CI and independent review.
- PC01 is limited to verified backup, runtime deployment, restart and live acceptance.
- No PC01 reboot, credential/security change, paid action, destructive action, Core mutation, or NV03/NV04 activation is authorized.

## Completion

Executor reports IMPLEMENTATION_COMPLETE. Terminal DONE requires exact-head CI, independent review/judge, merged commit, verified artifact provenance, NV02-only live evidence, recovery evidence and rollback readiness.