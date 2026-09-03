# Current State

Date: 2026-09-04

TigerIQ AI Lab remains evidence-gated. MAIN/Production are unchanged; no automatic merge or Production release is authorized. OpenClaw remains explicitly suspended from the current scope.

## Owner-locked architecture direction — 2026-09-04

The active development direction is now defined by `docs/roadmap/TIGERIQ-CONTINUOUS-DEVELOPMENT-FLOW-V2.md`.

Architecture decisions:
- PC01 = primary Source/runtime node for TigerIQ AI Lab and TigerIQ Driver.
- Core loop retained: Goal → Decompose → Queue → Mission → Worker → Verify → Evidence → DONE → auto-claim next eligible goal.
- Cloudflare Tunnel + Access = preferred external browser access path; daily phone use should not require Tailscale/VPN.
- Tailscale = trusted technical/emergency access only.
- Vercel = preview/backup/launcher only, not primary runtime.
- Web Control = PC01 control plane over real queue/state/workers/providers/evidence.
- Multi-AI architecture = Provider Registry → AI Gateway → Model Router → AI Employee Pool → Parallel Scheduler → Reviewer Swarm → Judge → Evidence.
- API secrets remain PC01/server-side only; no frontend/GitHub/Vercel secret exposure.
- Paid, financial, irreversible, security-sensitive and Production actions remain authorization-gated.

## Active priority — WO-065 Continuous Operations V1

Status: REPOSITORY IMPLEMENTATION/CI PASS ON CODE HEAD — PHYSICAL PC01 GATE PENDING

Branch: `wo065/continuous-operations-v1`
Base: verified WO-060..064 PC01 Autonomy Completion Pack
Work Order: `docs/work-orders/WO-065-CONTINUOUS-OPERATIONS-V1.md`
Draft review: PR #228, targeted to `wo060/mission-decomposition-v1`; not authorized for merge.

Implemented:
- Durable explicit top-level goal queue.
- P0/P1/P2/P3 priority and dependency validation.
- Dependency terminal failure propagates to `blocked_dependency` instead of hanging forever.
- One active injected/running goal at a time; authorization-held work frees the slot for independent safe work.
- Deterministic mission IDs and durable state prevent duplicate injection across restart windows.
- Global pause blocks new injections while reconciliation continues.
- Empty queue never invents work.
- Existing Mission Orchestrator and WO-059 Authorization Engine remain authoritative.
- PC01 installer + one-command physical E2E script prepared.

Repository evidence before roadmap documentation update:
- exact code head `81dd0ae326017d94efc719e81adecd55510fd930`;
- GitHub Actions run `33784226498` SUCCESS;
- 79 tests PASS, 3 integration tests skipped by environment;
- Continuous Operations suite 9 PASS;
- Playwright 1/1 PASS;
- build PASS;
- PowerShell parser gate PASS.

Physical gate still required:
- install WO-065 on physical PC01;
- prove two queued safe goals continue without per-goal Owner action;
- prove authorization-held work does not block an independent GREEN goal;
- prove pause/resume + restart recovery without duplicate injection;
- record machine-readable allPass=true evidence with runtime health checks and no MAIN/Production/financial action.

## Continuous development sequence after WO-065 physical PASS

1. Durable State + Event Journal.
2. Recovery + Watchdog + stuck detection.
3. Project Isolation for AI Lab vs Driver.
4. Secret Vault.
5. Provider Registry.
6. AI Gateway.
7. Model Router.
8. AI Employee Registry.
9. Massive Parallel Scheduler.
10. Concurrency/Quota/Cost Guard.
11. Reviewer Swarm.
12. Judge / Final Gate.
13. Evidence Engine.
14. Web Control backend over live PC01 state.
15. Web Control UI target >=95% approved mockup visual fidelity with 100% real data/function paths.
16. Mobile PWA.
17. Cloudflare Tunnel + Access.
18. Vercel/Tailscale role reduction.
19. PC02 standby design.
20. One-shot PC01 Foundation E2E.
21. Real API provider onboarding through Gateway.
22. Massive-AI real-project E2E and stabilization.

## Completed — WO-060..064 PC01 Autonomy Completion Pack

Status: DONE — REPOSITORY + PHYSICAL PC01 GATES PASS
Physical evidence: `docs/evidence/WO-060-064-PC01-AUTONOMY-QUICK-FINAL-20260903T104820Z.json`
Repository evidence: GitHub Actions run `33746442244` SUCCESS on `fd42ade412fc4beded95ec19b0ab215d6796b847`.

Verified:
- safe mission children completed;
- RED financial-class child remained authorization-held;
- mission closed-loop state correctly became `waiting_authorization`;
- Controller/PostgreSQL/PC01/Ollama/Supervisor healthy;
- `qwen3:8b` GPU offload confirmed;
- MAIN/Production untouched; no financial action; no secret printed.

## Completed — WO-059 Authorization Engine V1

Status: DONE — PHYSICAL PC01 POLICY E2E PASS
Physical evidence: `docs/evidence/WO-059-AUTHORIZATION-ENGINE-E2E-20260903T094429Z.json`

## Completed — WO-058 Autonomous Planner V1

Status: DONE — PHYSICAL AUTONOMOUS E2E PASS
Physical evidence: `docs/evidence/WO-058-AUTONOMOUS-PLANNER-E2E-20260903T092538Z.json`

## Completed foundation — WO-057 PC01 Primary AI Compute & Control Node

Status: DONE — PHYSICAL PC01 E2E A→G PASS
Physical evidence: `docs/evidence/WO-057-PC01-PRIMARY-NODE-E2E-20260903T084302Z.json`
