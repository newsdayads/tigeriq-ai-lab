# Core updater squash-gate fix

Date: 2026-09-11

Root cause: the runtime updater validates the exact `origin/main` SHA, but CI and Vercel verification previously ran only on pull-request SHAs. Squash merge changes the SHA, so the merged `main` commit could never satisfy all updater gates.

Fix: run CI and Vercel Online Verify on `main` pushes as well. Queue Hygiene already runs on `main`. The updater therefore continues to require all three successful workflow names on the exact candidate `origin/main` SHA before fast-forwarding PC01.

Acceptance: after merge, the exact `main` SHA must produce successful `CI`, `WO-014 Queue Hygiene`, and `WO-012/013 Vercel Online Verify` runs before PC01 runtime update is eligible.
