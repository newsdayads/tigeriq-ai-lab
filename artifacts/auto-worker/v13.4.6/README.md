# TigerIQ Auto Worker V13.4.6 — Superseded by V13.4.7

Parent: #306
Branch: `auto-worker/v13.4.6-source`
Status: SUPERSEDED after physical next-turn stall finding.

V13.4.6 fixed submit reconciliation, readiness diagnostics, larger Tiger/countdown, hidden-by-default panel, and preserved the physical window lock. Physical testing then exposed a new logic bug: the runtime marked a stable assistant response as consumed before the next `2` turn was actually acknowledged. If that dispatch path transiently returned false, later ticks skipped the retry forever.

Current candidate: **V13.4.7** on branch `auto-worker/v13.4.7-source`, evidence path `artifacts/auto-worker/v13.4.7/README.md`.

Do not rebuild or promote V13.4.6 again. Preserve the locked window placement **504×834 / Top5 / Right5** and all accepted UI baselines.
