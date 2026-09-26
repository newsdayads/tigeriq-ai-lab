# TigerIQ System Cleanup Evidence — 2026-09-11

## Runtime
- Canonical checkout: `D:\TigerIQ\Workspace\tigeriq-ai-lab` on `main`.
- Core Scheduled Task action points to `scripts\tigeriq-core\run-core.ps1` in that checkout.
- Core health: `ok=true`.
- `verify-core.mjs`: PASS, resources=11, durable objective `OBJ-E2E-578-1` present.
- Active TigerIQ tasks after cleanup: Core / Desktop Commander Remote / Ollama Runtime.
- 19 disabled legacy tasks were exported to `D:\TigerIQ\TaskBackup\cleanup-20260911` before removal.

## PC01 Git hygiene
- Dirty legacy checkout content was stashed before cleanup.
- Diverged local `main` commit was preserved under an archive branch before reset to `origin/main`.
- Legacy worktrees/clones moved to `D:\TigerIQ\Archive\cleanup-20260911`.
- #581/#582 development lanes retained.

## GitHub hygiene
- Core PR #579 merged to `main`.
- PR #583 canary: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify` all PASS; closed without merge.
- `main` protection requires those 3 strict checks + 1 approval + stale-review dismissal + conversation resolution.
- Force-push/delete disabled on `main`.
- 41 fully merged remote branches deleted; branch→SHA manifest: `D:\TigerIQ\Archive\cleanup-20260911\github-merged-branches-deleted.tsv`.
- Unmerged branches retained.
- Active open issues reduced to #280, #335, #497, #504, #581, #582.

## Source of Truth
- CENTRAL #280 → v38.
- Registry #335 → v38.
- Interaction #504 → v10.
