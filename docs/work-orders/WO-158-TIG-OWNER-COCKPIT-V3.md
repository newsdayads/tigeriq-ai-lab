# WO-158 — TIG Owner Cockpit V3

Status: FOLLOW-ON WEB UI · OFF MAIN/PRODUCTION · DO-NOT-MERGE UNTIL INDEPENDENT REVIEW

Frozen reviewed baseline: PR #117 exact `c599d853ec311247bbc222d1f97ffd13f3e909c7`.
Issue: #158.

## Implemented owner IA
Primary navigation is exactly:
1. Tổng quan
2. CẦN SẾP
3. Công việc
4. Công ty
5. Hệ thống

Desktop uses a left Owner Cockpit sidebar. Mobile at 390×844 removes the desktop sidebar surface and uses a five-item safe-area bottom navigation.

Owner overview priority is company summary → CẦN SẾP → Goal/KPI → Mission → Outcomes → low-priority system health. Existing Goal/KPI, Mission, Outcome, Process, Department/AI Employee and Technical Operations render targets remain available under the five destinations.

## Preserved reviewed boundaries
- Mock remains `authoritative=false` and visibly MẪU.
- CẦN SẾP remains fail-closed; `decision_ref != owner_approval_ref`; Web does not infer AUTHORIZE.
- Mission→Job remains reference-only; Job/Lease/Result/Evidence are not duplicated into Mission.
- Trello is removed from TigerIQ by Owner decision 2026-09-03; Owner Cockpit must not parse, project, display, or depend on Trello state.
- Internal work/state remains sourced from current TigerIQ authoritative state and GitHub where applicable; no external workboard may become a shadow control plane.
- Finance/business values remain unavailable unless an authoritative projection with provenance exists.
- Owner OAuth/write boundary, Controller contract, Business State adapter and PC01/Android/PostgreSQL runtime are unchanged by WO-158.

## Required release-candidate gates
Exact-head Typecheck, Unit/contract, desktop Playwright, iPhone 390×844 Playwright, Build, Queue Hygiene, Vercel Verify and exact-SHA Vercel Preview READY are required before `TIG_OWNER_COCKPIT_V3_READY_FOR_REVIEW` may be emitted and handed to CHAT05.
