# WO-045 PC01 autonomy bootstrap evidence — 2026-08-31

Status: `REAL_BLOCKER_BOOTSTRAP_DEADLOCK`

## Scope
PC01 autonomous runtime only. MAIN/Production, Web Control, Android App, AI Coordinator and Work Management were not modified.

## Repository/software gate
- Branch: `wo045/pc01-autonomy-hardening`
- Secure Worker V3 removes model-controlled raw shell/argv execution and uses typed tools only.
- Worker queue keeps bounded lease/retry and durable state/audit.
- Deterministic `TIGERIQ_COMMAND_V1` does not require Ollama.
- AI Work Orders fail closed unless Executor/Reviewer/Judge are configured as three distinct local model identities.
- Versioned watchdog uses a global mutex, removes duplicate worker processes and performs bounded Scheduled Task recovery.
- Bootstrap preserves existing Scheduled Task trust boundary and requires startup/recurring recovery triggers.
- Exact head before this evidence record: `2bb5cddcef327fd1fd2981243f15f67755195120`.
- GitHub CI run `33359063578`: PASS.
- PC01 Secure Worker run `33359063609`: PASS.

## Runtime ingress audit
Canonical deterministic canary issue #58 still has no PC01 CLAIM/RESULT evidence at the audit point. Canonical Workforce Controller issue #100 also has no PC01 CLAIM/RESULT evidence.

A new bounded out-of-band recovery attempt was added through GitHub Actions self-hosted runner, with all execution guarded by the expected Windows/F:\\TigerIQ layout and with checkout credentials not persisted.

Attempts:
1. Run `33359032029`, labels `[self-hosted, Windows]`: remained queued; no runner accepted it.
2. Run `33359058380`, label `self-hosted` with in-script PC01 layout guard: remained queued; no self-hosted runner accepted it.

Therefore the GitHub self-hosted runner is not an available PC01 ingress at this point. The existing GitHub issue worker ingress is also not processing #58. No authorized Tailscale SSH/WinRM/RDP or other remote execution channel is evidenced in the repository/current issue state.

## Prepared recovery package
- `.github/workflows/wo045-pc01-selfhosted-bootstrap.yml`
- `scripts/pc-worker/runner_bootstrap_pc01.py`
- `scripts/pc-worker/worker_secure_v3.py`
- `scripts/pc-worker/worker_runtime_launcher.py`
- `scripts/pc-worker/control_plane_v2.py`
- `scripts/pc-worker/worker-watchdog-v3.ps1`

The bootstrap is designed to:
1. verify PC01 layout and existing Scheduled Tasks;
2. verify startup/watchdog recurrence contract;
3. run source/security regression tests;
4. back up installed runtime before replacement;
5. install Secure Worker V3 atomically;
6. run worker preflight without Actions token fallback;
7. restart `TigerIQ Worker`;
8. require real issue #58 `secure-v3-command` CLAIM/DONE evidence;
9. stop Worker once and require watchdog `worker_recovered` evidence.

## Blocker conclusion
No further remote mutation of PC01 is truthful or safe until at least one already-authorized ingress becomes live. Repository changes alone cannot start a stopped/offline local Scheduled Task or offline GitHub runner.

Completion tokens MUST NOT be emitted yet:
- `PC01_AUTONOMOUS_INGRESS_PASS`
- `PC01_WATCHDOG_RECOVERY_PASS`
- `PC01_WORKFORCE_CONTROLLER_PASS`

Do not create repeated canary/retry issues. Resume from canonical #58/#57 when ingress exists.
