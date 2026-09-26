# Evidence — #770 Web Control Health parity

Date: 2026-09-15
Owner UI: `http://100.97.23.87:8796`
Reference prototype: TigerIQ API Health `:8795`
PR: #771 — parity API Health + live refresh + system font

## Runtime verification
- Candidate source deployed from branch `nv05/issue-767-health-parity-font-refresh`.
- Runtime candidate SHA at final visual capture: `fe757813d8f33640071eceeee468506813b212d4`.
- Web Control `/health`: `ok=true` after deployment/restart.
- Base UI refresh contract: `/api/status` every 2000 ms.
- Visible freshness control: `LIVE · 2s`; stale threshold > 6 seconds.
- Provider cards include icon tile, spark/status, provider/model, current job, last seen, latency, cooldown/error and 24h success rate.
- Overview includes API Health KPI set, telemetry/P95 chart, recent jobs, events and Local/Cloud/Problem filters.

## Typography verification
- Body: `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`.
- Body size/line height: `14px / 1.5` with antialiasing.
- Code/log/terminal: `"SFMono-Regular", Consolas, "Roboto Mono", "Liberation Mono", Menlo, monospace`, 13px.

## Visual evidence on PC01
- Desktop 1648x928: `D:\TigerIQ\Evidence\web-control-health-parity-desktop-final-20260915-091423249.png` — PASS.
- Mobile 430x932: `D:\TigerIQ\Evidence\web-control-mobile-topbar-pass-20260915-091653430.png` — PASS.
- Mobile fixes verified: single KPI column, bounded controls/cards, no visible horizontal clipping, health and LIVE pills fully visible.

## Incident / correction
First candidate copy used a PowerShell text pipeline and produced UTF-8 mojibake. Runtime deployment was corrected to byte-preserving `git show > file`, then screenshots were regenerated; final evidence above has correct Vietnamese text.

## Gate
Owner explicitly waived independent review for this iteration. Required completion gates are CI on exact final PR head plus runtime visual verification. No credential, paid-service or destructive changes were made.
