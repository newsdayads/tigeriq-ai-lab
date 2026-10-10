# P0 #4640 — GitHub Projects V2 automation (PC01)

## Status
- Implementation: `scripts/github-projects-automation.mjs`.
- Source: 8 private Projects owned by `newsdayads`; GitHub CLI authenticated with `project` scope.
- **Fail-closed:** no deployment/schedule unless current GitHub Projects inventory + Core provenance dry-run PASS.
- Does not write Core, assign workers, dispatch P0, create GitHub Issues/PRs, access raw Driver issue #366, or execute Coin/miners.
- No GitHub token checked into Git. CLI reads its existing keyring in current OS principal; no export to files or logs.

## Classification
- Dedicated repositories map to the canonical project; the shared `tigeriq-ai-lab` repository requires an explicit bracketed project code (e.g. `[P1][CORE]`, `[P1][PAPERCLIP]`) or `project:<CODE>` label.
- Conflicting/unknown project codes are held for review. Existing Master `PROJECT` assignment is authoritative. Existing URLs are reused, no copying source Issue/PR.
- Added items go to Master and the relevant dedicated Project. No cross-project project field mutation.

## Core status projection
- HTTPS `/api/live-status` must be connected, source=Core, work projection complete, fresh within 120s. Unknown statuses are ignored.
- Only verified metadata statuses from Core are reflected onto **existing** Project rows. RUNNING requires matching live activeWork evidence.
- A stale Core or API failure is recorded without inventing a successful sync.

## Operational commands (PC01 SYSTEM context)
- `node scripts/github-projects-automation.mjs --dry-run` (default; **zero mutations**)
- `node scripts/github-projects-automation.mjs --write` (**only after verified preflight and approval**)
- bounded to 40 metadata operations/cycle; no blind retries. Failures per issue/project do not stop other safe actions.
- status: `latest-portfolio-report.json` beside repository source parent (local only, no secrets).

## Acceptance gates
1. 8/8 Projects private and complete metadata; no missing/duplicate mappings.
2. Unit and isolation tests: `node --test tests/github-projects-automation.test.mjs`.
3. Real dry-run PASS with fresh Core and GitHub API available. Inspect counts and quarantine.
4. Explicit write-cycle under Owner authorization; verify subsequent readback/no duplicates.
5. Install bounded PC01 schedule only after gates 1–4. No changes to Vercel Production branch, PC01 App Chrome or Coin runtime.
