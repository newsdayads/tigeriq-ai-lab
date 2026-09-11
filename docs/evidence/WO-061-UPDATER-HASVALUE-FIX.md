# WO-061 updater runtime fix

Observed after first path-aware rollout: the updater completed the fast-forward and Coding Lane restart, but final state serialization failed because PowerShell unboxed `Nullable[int]` and `.HasValue` was not available.

Fix: represent missing Core PID as `$null`, compare with `$null`, and never access `.HasValue`/`.Value`.

Acceptance: updater can record `UPDATED` or `NO_CHANGE` without restarting Core for non-Core paths.
