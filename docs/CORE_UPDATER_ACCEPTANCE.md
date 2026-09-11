# Core runtime updater acceptance

The updater may install a new `origin/main` SHA only when all three workflow names have completed successfully on that exact SHA:
- `CI`
- `WO-014 Queue Hygiene`
- `WO-012/013 Vercel Online Verify`

This requirement intentionally validates the merged `main` commit itself, including squash merges.
