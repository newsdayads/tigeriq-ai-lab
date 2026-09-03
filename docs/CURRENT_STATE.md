# Current State

Date: 2026-09-04

TigerIQ AI Lab remains evidence-gated. MAIN/Production are unchanged; no automatic merge or Production release is authorized. OpenClaw remains explicitly suspended from the current scope.

## Owner-locked architecture direction — 2026-09-04

The active development direction is defined by `docs/roadmap/TIGERIQ-CONTINUOUS-DEVELOPMENT-FLOW-V2.md`.

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

## Active repository work — WO-066 Foundation + Multi-AI V1

Status: IMPLEMENTED — EXACT-HEAD REPOSITORY CI PENDING

Branch: `wo066/foundation-multiai-v1`
Base: `wo065/continuous-operations-v1`
Work Order: `docs/work-orders/WO-066-FOUNDATION-MULTIAI-V1.md`

Implemented without credentials/provider network calls:
- append-only ordered Event Journal with idempotency and integrity verification;
- AI Lab vs Driver project runtime namespace isolation;
- heartbeat/stuck detection, bounded retry/restart and exponential retry delay;
- secret-reference-only contract plus log/evidence redaction helper;
- Provider/Model Registry core;
- normalized capability/health/quota/cost-aware Model Router and fallback;
- AI Employee Registry role resolution;
- dependency-aware priority Parallel Scheduler with global/provider concurrency;
- independent reviewer assignment excluding author self-approval;
- Judge outcomes PASS / FIX / BLOCKED / AUTHORIZATION;
- provider and AI employee configuration templates with external providers disabled by default.

Repository gate required before claiming WO-066 PASS:
- exact-head typecheck;
- all unit tests including runtime foundation + AI gateway suites;
- Playwright smoke;
- build;
- existing WO-065 PowerShell parser gate remains green.

## Upstream operational gate — WO-065 Continuous Operations V1

Status: REPOSITORY CODE/CI PASS — PHYSICAL PC01 GATE PENDING

Branch: `wo065/continuous-operations-v1`
Draft PR: #228; not authorized for merge.
Repository evidence on code head `81dd0ae326017d94efc719e81adecd55510fd930`: GitHub Actions run `33784226498` SUCCESS; 79 tests PASS / 3 environment integration tests skipped; Playwright 1/1 PASS; build + PowerShell parser PASS.

Physical gate still required:
- install WO-065 on physical PC01;
- prove two queued safe goals continue without per-goal Owner action;
- prove authorization-held work does not block an independent GREEN goal;
- prove pause/resume + restart recovery without duplicate injection;
- record machine-readable `allPass=true` evidence with runtime health and no MAIN/Production/financial action.

## Next continuous repository sequence after WO-066 gate

1. Wire Event Journal + Recovery into live services.
2. Concurrency/Quota/Cost Guard policy and usage accounting.
3. Evidence Engine + Reviewer Swarm orchestration + Judge gate integration.
4. Web Control live backend over PC01 state/providers/workers/evidence.
5. Web Control UI target >=95% approved mockup with real data/control paths.
6. Mobile PWA.
7. Cloudflare Tunnel/Access deployment design + one-shot PC01 installer.
8. PC02 standby/backup design.
9. Real API provider adapters/onboarding after Owner supplies credentials.
10. Massive-AI E2E and stabilization.

## Completed foundation

- WO-060..064 PC01 Autonomy Completion Pack — DONE, repository + physical gates PASS. Evidence: `docs/evidence/WO-060-064-PC01-AUTONOMY-QUICK-FINAL-20260903T104820Z.json`; CI run `33746442244` success on `fd42ade412fc4beded95ec19b0ab215d6796b847`.
- WO-059 Authorization Engine V1 — DONE, physical policy E2E PASS. Evidence: `docs/evidence/WO-059-AUTHORIZATION-ENGINE-E2E-20260903T094429Z.json`.
- WO-058 Autonomous Planner V1 — DONE, physical autonomous E2E PASS. Evidence: `docs/evidence/WO-058-AUTONOMOUS-PLANNER-E2E-20260903T092538Z.json`.
- WO-057 PC01 Primary AI Compute & Control Node — DONE, physical PC01 E2E A→G PASS. Evidence: `docs/evidence/WO-057-PC01-PRIMARY-NODE-E2E-20260903T084302Z.json`.
