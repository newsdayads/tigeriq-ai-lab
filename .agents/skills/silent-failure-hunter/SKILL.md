---
name: silent-failure-hunter
description: Audit Core, Coding Lane, App Chrome, and Kotlin/TS code for swallowed exceptions, empty catch blocks, and unlogged fallback paths before merge.
---

# Silent Failure Hunter (Adapted from affaan-m/ECC)

## Mission
Prevent silent failures where errors are swallowed (`catch {}`, `try { ... } catch {}`), causing stale state, deadlocks, or false `PASS` signals.

## Checklist
1. Flag every empty `catch {}` or `catch { return null }` in `apps/tigeriq-core/`, `apps/tigeriq-coding-lane/`, and App Chrome bridge/server.
2. Ensure every caught error either:
   - Logs a structured diagnostic event (`event`, `error`, `workerId`/`jobId`), OR
   - Explicitly documents why ignoring it is safe (e.g., cleanup `unlinkSync` on an optional marker file).
3. Never downgrade a failing check, missing receipt, or timeout into a silent `PASS`.
