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
- F5 is independently randomized between 5 and 10 minutes, never selects work, executes when due even during WORKING, and is not rescheduled by Auto/dispatch.
- Planned Chrome reset is independently randomized between 2 and 4 hours, executes when due even during WORKING, checkpoints local continuity, reopens Chrome, and returns to the same NV02 project/chat URL when valid so the same job resumes. Periodic reset does not archive the chat.
- Chrome/App restart preserves overdue F5/reset intent instead of silently rebasing an overdue timer into a fresh future window.
- Recovery is bounded and must fail closed on security, authentication, ambiguous delivery, lease conflict, or stale identity.

## Runtime security

- The App Chrome controller receives no GitHub credential in NV02 V2.
- Legacy APP_CHROME_SELF_RUN backlog scanning/claiming is disabled.
- Source engineering is GitHub branch to PR to exact-head CI and independent review.
- PC01 is limited to verified backup, runtime deployment, restart and live acceptance.
- On bridge/PC boot, an already verified NV02 chat is restored/preserved without forcing model-selector mutation while the UI is still settling; stale chat-load recovery state is cleared, the exact chat + durable GPT-5.6 Sol/High gate must remain stable before normal continuation is re-armed, and bounded retry is used on slow/heavy chat load.
- No PC01 reboot, credential/security change, paid action, destructive action, Core mutation, or NV03/NV04 activation is authorized.

## Completion

Executor reports IMPLEMENTATION_COMPLETE. Terminal DONE requires exact-head CI, independent review/judge, merged commit, verified artifact provenance, NV02-only live evidence, recovery evidence and rollback readiness.