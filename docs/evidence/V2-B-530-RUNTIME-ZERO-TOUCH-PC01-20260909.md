# V2-B / #530 Runtime Zero-touch — PC01 Evidence

Date: 2026-09-09
Issue: #530
Scope: Runtime / Zero-touch / Web runtime truth only. AI provider/router ownership from #529 was not modified.

## Source and release
- Core runtime branch: `issue-530-runtime-core`
- Core commit: `fce9d1a933f0a810d25a0e64a802fffa41df31ab`
- Web truth branch: `issue-530-runtime-zero-touch`
- Web code commit: `c681f1146dd8e2727325af659e82f857c53ffe2d`
- Durable Web release-channel commit: `1c42466e817c984e1ac6216fe068b96e8c327300`
- Release workflow run: `34325384490` — success
- PC01 Updater V3: `NO_CHANGE` after install; current release points to `1c42466...`.

## B1 — no manual CMD/PowerShell in normal job hot path — PASS
- Canonical path is Web/ingress -> Workforce Controller -> PostgreSQL queue/lease -> Native Worker -> result/evidence.
- Controller and PC01 Native Worker Scheduled Tasks execute `node.exe` directly.
- Final live canary: `JOB-530-E2E-1788940175432`, observed `queued -> done`, attempt 1, executor `EMP-PC01-NATIVE`, device `DEV-PC01`, evidence count 1, deterministic resource snapshot returned.
- Web `/api/server` implementation no longer invokes `pc01-telemetry.ps1` or `powershell.exe`.
- 200 consecutive live `/api/server` requests: exit PASS; direct Web child process names observed only `gh.exe`; PowerShell/CMD child observations = 0; live `server.js` shell references = 0.

## B2 — queue/service continues without owner interaction — PASS
- Controller/Native Worker/Planner/Orchestrator/Supervisor are Scheduled Tasks with restart policy and `IgnoreNew` multiple-instance policy.
- Final canary was leased and completed automatically after one standard ingress enqueue; no owner command was used to claim or execute the job.
- OpenClaw gateway, Controller, Native Worker, Planner and Orchestrator were all observed running concurrently.
## B3 — safe self-heal/recovery — PASS
- Native Worker kill test: Web truth changed to `pc01Online=false`, Task became `Ready`; no manual start was issued. Automatic recovery produced a new Worker PID and Web truth returned `pc01Online=true` with fresh heartbeat `2026-09-09T07:53:39.827Z`.
- Controller kill test: Web truth changed to `available=false`, Controller Task became `Ready`; no manual start was issued. Automatic recovery produced PID `39924`; Web returned `available=true`, Controller online, PostgreSQL online, PC01 online and `truthSource=workforce-controller-v1`.
- Controller and Native Worker restart policy: 10 retries, 1-minute interval.

## B4 — Web shows canonical runtime truth — PASS
- New authenticated Controller endpoint: `/api/v1/runtime-truth`, protocol `runtime-truth-v1`, source `workforce-controller-v1`.
- Truth is derived from PostgreSQL operational state for employees/heartbeats, providers, jobs, leases and stage counts.
- Final direct-vs-Web comparison matched exactly: stages `{done:75, failed:21, reviewing:9}`, queued `0`, active leases `0`, PC01 online `true`, heartbeat `2026-09-09T07:55:41.807Z`.
- Web exposes queue/job stages, provider freshness/staleness, PC01 heartbeat and canonical worker roster; missing truth fails closed to unavailable instead of shell-derived inference.

## B5 — no duplicate execution owner — PASS
- Final Node process counts: Controller 1, Native Worker 1, Planner 1, Mission Orchestrator 1, OpenClaw Gateway 1.
- Listener counts: Web 8787 = 1, Controller 8790 = 1, Ollama 11434 = 1, OpenClaw 18789 = 1.
- Task policy uses `IgnoreNew`; no new parallel queue consumer/service was introduced.
- Planner/Orchestrator/Supervisor/OpenClaw launch/recovery wrappers remain automatic startup/recovery plumbing only; job execution itself uses the Controller/queue/service path.

## Verification
- Core typecheck + build: PASS.
- Core focused regression: 3 files / 9 tests PASS.
- Web typecheck + build: PASS.
- Web focused regression: 4 files / 11 tests PASS.
- Command Center release workflow: success; Updater V3 installed the release atomically and a second run returned `NO_CHANGE`.
- MAIN/Production, billing/PAYG, reboot, credentials and #529 provider/router logic were not modified.

Final state: `V2_B_530_DONE_B1_B5_LIVE_VERIFIED`.