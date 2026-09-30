# APP CHROME — MASTER CONTRACT 3 UI V1

Source of Truth: GitHub issue #2621.

## Role
App Chrome is local UI transport/continuity only. It keeps NV02/NV03/NV04 alive, isolated, observable and recoverable. It never scans/ranks/selects/claims the GitHub backlog.

## Worker routing
- NV02: ChatGPT Plus primary executor; external to Core; NV02 itself self-pulls eligible P1-P5 from canonical GitHub, max one active main job; P0 and App Chrome self-maintenance fail closed.
- NV03: ChatGPT Go independent review/QA; Core-routed only; no self-pull.
- NV04: Gemini Pro deep research/second opinion; Core-routed only; no self-pull.

## Exact continuation contract
All three workers use the same exact 21-content pool, with immutable worker prefix and no suffix/rewrite:
- NV02 prefix: `02 - `
- NV03 prefix: `03 - `
- NV04 prefix: `04 - `

Pool:
1. Tiếp tục
2. Làm tiếp
3. Tiếp đi
4. Xử lý tiếp
5. Thực hiện tiếp
6. Tiếp tục công việc hiện tại
7. Làm tiếp công việc hiện tại
8. Tiếp tục việc đang làm
9. Làm tiếp phần đang dở
10. Tiếp tục từ chỗ hiện tại
11. Tiếp tục đúng việc này
12. Xử lý tiếp việc hiện tại
13. Thực hiện tiếp việc đang làm
14. Tiếp tục phần còn dở
15. Tiếp tục từ trạng thái hiện tại
16. Tiếp tục xử lý việc đang dở
17. Tiếp tục công việc đang dang dở
18. Thực thi tiếp việc hiện tại
19. Làm tiếp nhiệm vụ đang thực hiện
20. Tiếp tục đúng việc đang được giao
21. Làm tiếp, không đổi việc

No long self-pull wake prompt. No `TIGERIQ_CHAT_ROTATE_READY` suffix. No immediate repeat.

## State behavior
- WORKING: no prompt, no F5/reset that interrupts work.
- READY: exactly one allowed continuation prompt if worker policy has active work/self-pull wake eligibility.
- STALLED: bounded retry/reload/reopen with backoff.
- BLOCKED/auth/CAPTCHA/security: fail closed.
- Pause wins all automatic actions.
- `awaitingWorkStart` prevents duplicate sends.

## Lifecycle
- NV02 F5: randomized 5–10 minutes, deferred while WORKING.
- NV03/NV04 F5: generic randomized 5–20 minutes, deferred while WORKING.
- 2–4h reset only when not WORKING; preserve valid existing assigned/current chat when possible.
- Each worker recovers independently; no cross-worker mutation.
- Startup/reboot restores exactly one top-level Chrome per worker in the interactive desktop session.

## Chat lifecycle
No automatic archive/rotation by prompt count, chat age, terminal marker, or idle marker.
Archive/new chat only for genuine broken context after bounded recovery or explicit Owner action.
Archive flow: current chat header menu -> Lưu trữ -> verify current conversation was left -> fresh chat in correct Project.
Archive failure forbids opening a new chat.

## Identity/model
NV02 dispatch requires visible ChatGPT UI verification of GPT-5.6 Sol + High.
NV03/NV04 preserve their canonical account/profile/project/app identity; do not apply NV02 model forcing.

## Release
Golden NV02 behavioral/recovery reference: `5cce41e70521bdc0e6ce0d7b7906c59c42c9c56d`.
Operational discipline: one GOLDEN + one CANDIDATE + one ROLLBACK.
Source changes: branch -> PR -> exact-head checks -> independent review -> merge. Only after source is complete may one bounded RDC install/live verification occur.
