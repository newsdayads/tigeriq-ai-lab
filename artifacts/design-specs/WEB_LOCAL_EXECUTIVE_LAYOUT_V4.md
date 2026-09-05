# WEB LOCAL EXECUTIVE LAYOUT V4 — APPROVED VISUAL SPEC

Source: user-provided reference screenshot in ChatGPT on 2026-09-05. This file captures the implementation contract; no synthetic KPI values are allowed.

## Geometry / hierarchy
- Desktop reference: 1648×928.
- Left sidebar: compact fixed rail ~138px, dark navy, full height.
- Top header: ~68px, begins after sidebar; title left; search + owner controls right.
- Main canvas: dark navy/blue, ~20px gutters.
- KPI row: five equal cards, 12–14px gaps, strong blue/purple/green/orange/green gradients.
- Main row: work table ~72–74% width; analytics stack ~26–28% width.
- Bottom: team panel left, system-health panel center, owner-action/status stack right.
- Footer: quote left, TigerIQ identity right.

## Visual language
- Segoe UI only; body 14–15px equivalent, support text >=13px.
- Thin Fluent-style inline SVG icons, no emoji icons.
- Card radius 12–14px; 1px blue/slate borders; subtle inner highlight and low-elevation shadow.
- Background palette: midnight navy / deep slate; accents blue, cyan, green, violet, orange, red.
- Active sidebar item: blue fill with brighter left edge.
- Table header: slightly lighter blue slab; rows compact, 50–54px visual height.
- Status chips: compact pill, semantic color.

## Overview modules
1. Header: `TigerIQ AI Lab` / `Bảng điều hành`.
2. KPI: Đang làm / Ai phụ trách / Tiến độ / Vướng mắc / Cần anh Sơn.
3. `Công việc đang chạy`: max 5 live lanes, real data only.
4. Right analytics: Phân bổ công việc / Tải theo nhân sự / Trạng thái hệ thống.
5. `Đội AI`: Vy, Minh, Khoa, Huy, Khải cards.
6. `Hệ thống`: PC01 Server / Control Plane / Web Local / Auto Worker when evidence exists; unknown stays unknown.
7. `Cần anh Sơn`: explicit owner-action only; otherwise calm green state.

## Primary navigation target
- Tổng quan
- Công việc
- Dự án
- Nhân sự
- Hệ thống
- Báo cáo
- Cài đặt

No function may be deleted. Existing `models` and `evidence` routes remain available as secondary subviews from the related primary pages.

## Data integrity
- Never fabricate progress %, CPU/RAM, response time, work counts, deltas, or statuses.
- When numeric progress is not supported by evidence, render `—` or lifecycle text instead of estimating.
- Work distribution and personnel load are computed from current verified lanes only.

## Architecture reset
- Do not stack new presentation fixes on V13/V14/V15.
- Build one new top-level renderer on stable V12 functional surface.
- Overview is rendered from structured governance + telemetry data, not legacy dashboard HTML.
- Functional pages retain forms/actions and get only the new shared shell/theme; no overview DOM transforms.
- Regression checks cover overview + all functional routes + write passthrough.
