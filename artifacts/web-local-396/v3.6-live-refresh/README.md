# Web Local #396 V3.6 — Incremental Live Overview

Source: machine-real screenshots supplied by anh Sơn on 2026-09-05.

Fixes:
- replace malformed brand icon with a clean inline SVG mark;
- harden AI avatar alignment/ring rendering;
- eliminate the large blank area under `Công việc đang chạy` by using independent left/right dashboard columns;
- remove legacy 30-second full-page meta refresh;
- refresh overview data incrementally every 10 seconds without navigation/reload;
- only changed sections update and flash briefly;
- add `Live · 10 giây`, relative update age, error state, and manual refresh button;
- pause polling while the tab is hidden and refresh on return when stale.

Safety: non-MAIN artifact channel only. Real-data semantics remain unchanged. Final visual acceptance requires PC01 machine-real evidence on `100.97.23.87:8787`.