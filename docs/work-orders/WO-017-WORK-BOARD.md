# WO-017 — Evidence-first Work Board

Status: DONE
Date: 2026-08-30

## Goal
Give the owner one read-only operational view of TigerIQ work from GitHub Source of Truth, independent of browser-local tracking and independent of conversational GPT availability.

## Delivered
- Added deterministic `work-board` API operation backed by bounded GitHub issue/comment reads.
- Returns only sanitized fields: issue number/title/url, priority, type, lifecycle stage, timestamps/age, stale signal and evidence booleans; raw issue bodies and raw comment text are never returned.
- Aggregates recent marker-based Work Orders/commands with total/active/queued/claimed/completed/failed/cancelled/stale counts.
- Uses two bounded GitHub reads (issues + repository issue-comments), avoiding N+1 comment calls.
- `Công việc` now displays the system Work Board rather than only localStorage-tracked jobs.
- Open queued/claimed work is marked stale after 30 minutes without issue activity. Staleness is an operator attention signal only and does not mutate/cancel work.
- AI Gateway failure points to existing explicit `Giao việc` fallback.
- Persistent Queue Hygiene CI verifies the Work Board UI invariant.
- Preserved WO-014 dedupe, WO-015 lifecycle/PWA and WO-016 explicit dispatch.
- No PC01/OpenClaw/Ollama mutation, no Tiger IQ Driver changes, no AI Gateway billing retry.

## Verification
- Initial apply run `33312345949`: syntax/helper/UI/build gates PASS; generated push failed only because GitHub Actions token could not update another workflow without workflow permission.
- Root cause fixed by separating persistent workflow mutation into the connected GitHub control channel.
- Apply run `33312474076`: PASS.
- Final exact head `451773d1da6d03a5f102f19a7adc4336891bd25d`; one-time patcher/apply workflow removed from final diff.
- Exact-head Preview `dpl_8paVtUvu5bYTtY4cNttvUmiAMnvP`: READY.
- PR #73 exact-head gates: CI `33312567412` PASS; Queue Hygiene `33312567395` PASS; Vercel Verify `33312567410` PASS.
- PR #73 merged to MAIN as `d687e3d74eebc3c463d4fe943445857c19576e02`.
- Production deployment `dpl_BeGwJ9BNpTNfueU4wLZ5UVyFkFGU`: READY.
- Production `/api/control`: HTTP 200 with `workBoard=true`, `explicitDispatch=true`; queue remains #57/#58.
- Production `/`: HTTP 200 and includes Work Board UI code plus the direct `Giao việc` fallback hint.
- Available remote verifier is GET-only; it did not issue a direct Production POST to `operation=work-board`. The operation is covered by exact-head helper/UI/build gates and deployed Production code.
