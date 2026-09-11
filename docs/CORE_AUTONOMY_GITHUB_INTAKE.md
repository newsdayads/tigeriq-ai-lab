# Core autonomous GitHub intake

TigerIQ Core polls GitHub for explicitly executable, read-only autonomous work items.

Required issue markers:
- `TIGERIQ_EXECUTABLE=true`
- `OWNER_POLICY=AUTO`
- `NO_CODE_CHANGE=true`
- `NO_PC01_SHELL=true`

Lifecycle:
1. GitHub issue -> `OBJ-GH-<issue>` in PostgreSQL.
2. Core records `[CLAIM]` on the issue when the runtime token permits issue writes.
3. AI Manager routes the objective to eligible AI resources.
4. Terminal objective -> `[RESULT]`; completed issues are closed automatically.
5. Dedupe is objective-ID based, so restart/reboot cannot duplicate the same issue.

Runtime updates:
- `TigerIQ Core Runtime Updater` polls `origin/main` every 120 seconds.
- It applies only fast-forward commits whose required GitHub workflows succeeded.
- It refuses a dirty worktree.
- After apply it restarts only `TigerIQ Core 24x7`, checks `/health`, and rolls back on failure.

No raw token is written to GitHub, chat, or logs.
