# WO-017 — Evidence-first Work Board

Status: IMPLEMENTING
Date: 2026-08-30

## Goal
Give the owner one read-only operational view of TigerIQ work from GitHub Source of Truth, independent of browser-local tracking and independent of conversational GPT availability.

## Scope
- Add deterministic `work-board` API operation backed by public GitHub issue/comment evidence.
- Return only sanitized fields: issue number/title/url, priority, type, lifecycle stage, timestamps/age, stale flag, and evidence booleans; never return raw issue bodies or comment text.
- Aggregate recent marker-based Work Orders/commands with stage counts and stale count.
- Use two bounded GitHub reads (issues + repository issue-comments) rather than N+1 comment calls.
- Make the Web Control `Công việc` action display the system Work Board, not only localStorage-tracked jobs.
- Preserve WO-014 dedupe, WO-015 lifecycle/PWA, WO-016 explicit dispatch.
- No PC01/OpenClaw/Ollama mutation, no Tiger IQ Driver changes, no AI Gateway billing retry.

## Staleness policy
An open item in `queued` or `claimed` state is marked stale after 30 minutes without issue activity. This is an operator attention signal only; it does not auto-cancel or mutate the issue.

## Gates
- Pure helper tests for priority/type/stage/evidence/staleness and no raw-body/comment fields in summaries.
- Static UI invariant that `Công việc` calls `work-board`.
- Existing CI + Queue Hygiene + Vercel Verify PASS.
- Vercel Preview READY before merge.
- Production `/api/control` remains HTTP 200 and advertises `workBoard=true`; canonical PC01 queue remains #57/#58.