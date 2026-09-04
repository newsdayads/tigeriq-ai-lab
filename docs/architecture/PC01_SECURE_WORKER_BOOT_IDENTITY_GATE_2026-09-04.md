# PC01 Secure Worker Boot Identity Gate — 2026-09-04

Status: P0 design/evidence gate for #318. Off-MAIN only. No live PC01 mutation.

## Goal
Prove `Vy -> command mailbox -> PC01 Secure Worker -> evidence` can recover after a Windows reboot without repeated Owner shell/PowerShell actions, while preserving the existing security boundary.

## Verified current state
- Remote command mailbox delivery/execution/evidence succeeded 3/3 consecutively in #321, #323 and #324 without Owner PC interaction.
- `TigerIQ Workforce Controller` runs as `SYSTEM`, is enabled, has an `At system start up` trigger and a recurring 5-minute trigger (#327).
- `TigerIQ Worker` is enabled/running but is `Interactive only` with `At logon time` (#325).
- `TigerIQ Worker Watchdog` is enabled with one-minute recurrence but is also `Interactive only` (#326).
- Secure Worker V3 launcher performs an authenticated `gh api repos/<repo>` preflight and the worker posts claims/results through GitHub CLI. Therefore the worker's Windows identity must retain valid GitHub access.
- Historical Secure V3 persistence checks accepted either `BootTrigger` or `LogonTrigger`; that proves recovery after an eligible trigger, not boot-before-login.

## Security constraint
Do not silently convert the Worker/Watchdog principal to `SYSTEM`, copy GitHub credentials to a machine/service identity, enable Windows auto-logon, store a new password/token, or otherwise widen credential/security scope. Those are authorization-boundary changes.

## Acceptance interpretation
`AUTO_START_AFTER_REBOOT` is proven only by a physical reboot E2E showing, without Owner shell intervention:
1. Controller returns healthy.
2. Secure Worker becomes available automatically.
3. A fresh deterministic mailbox canary is claimed and completed.
4. Result/evidence is visible back in GitHub/ChatGPT.
5. No duplicate worker process or stale lease remains.

A logon-triggered Worker may satisfy this only if the machine independently reaches the required user logon state without Owner intervention. Current authoritative evidence does not prove that condition.

## Safe decision tree
1. First perform the authorized physical reboot E2E with the current configuration. Do not change credentials before evidence shows a need.
2. If Worker returns automatically and the mailbox canary completes, retain the current least-privilege user identity and record the actual recovery mechanism.
3. If Worker does not return until interactive login, stop and choose an explicit credential/security design before mutation:
   - Preferred minimal-change path: same least-privilege Windows user, non-interactive scheduled-task logon with Windows-managed stored credential; requires explicit Owner authorization/credential entry.
   - Do not default to `SYSTEM` + copied GitHub token because it broadens both OS and GitHub credential exposure.
   - A service/broker redesign is acceptable only if separately reviewed and justified over the minimal path.

## Regression requirement
Future bootstrap/self-heal must not claim boot autonomy solely from task existence, `Running` state, watchdog recurrence, or a generic `LogonTrigger`. Evidence must distinguish actual boot recovery from interactive-logon recovery.

## Gates still required
- Explicit Owner authorization before reboot.
- Explicit Owner authorization before any credential/principal/auto-logon/security-boundary mutation.
- Independent review for any engineering change that modifies the Worker/Watchdog startup identity or persistence mechanism.
- No MAIN/Production merge/release without the normal gate.