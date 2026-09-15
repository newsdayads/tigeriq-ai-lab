# Evidence — #772 Web Control Workforce Cards

Date: 2026-09-15
Owner objective: toàn bộ NV01–NV20 xuất hiện trong Bảng nhân sự AI; card gọn đúng 2 hàng; xem thêm bằng kéo ngang; không làm hỏng live refresh.

## Source / PR
- Branch: `nv05/issue-772-workforce-cards`
- PR: #774 - Full workforce cards NV01–NV20, 2-row strip
- Runtime source code commit verified: `2e23c42d4e19a0c4be9c76e5fa5b231639772f2e`
- CI run `34923968408`: PASS — PowerShell syntax, install, deployment policy, Typecheck, Unit tests, Playwright smoke, Build.

## Canonical identity
- Registry: GitHub #335, `REGISTRY_ROOT_VERSION=49`.
- Web Control `/api/status` runtime verification: `workforce=20`, `source=registry-335-live`, `version=49`.
- NV01 = Minh; NV02 = ChatGPT Plus.
- NV05 = RETIRED; NV09 = UNASSIGNED; these slots are shown truthfully rather than falsely marked OFFLINE.
- Legacy Core runtime `NV02/Ollama` is projected to canonical `NV10/Ollama`; verification confirmed no stale `NV02/Ollama` resource remained in Web Control projection.

## Runtime visual / DOM verification
Target: `http://100.97.23.87:8796/`

Measured at 1920×1080 after 4.5s live load:
- workforce cards: `20`
- IDs: `NV01` through `NV20`
- CSS grid rows: `82px 82px`
- grid flow: `column`
- `overflow-x: auto`
- `overflow-y: hidden`
- horizontal scrolling: `true`
- viewport card host width: `1316px`
- scroll content width: `2392px`
- card heights: exactly `82px`
- `LIVE · 2s`: present

Desktop screenshot on PC01:
`D:\TigerIQ\Evidence\web-control-workforce-2row-20260915.png`

## Result
PASS for Owner acceptance: full NV01–NV20 roster, NV01–NV09 retained, exactly two card rows, horizontal scroll, runtime enrichment, truthful non-API/retired/unassigned statuses, and live 2-second refresh retained.
