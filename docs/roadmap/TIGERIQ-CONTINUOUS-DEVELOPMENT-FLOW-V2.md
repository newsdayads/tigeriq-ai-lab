# TigerIQ Continuous Development Flow V2

Date: 2026-09-04
Status: OWNER-DIRECTED ROADMAP — SAFE FEATURE-BRANCH EXECUTION
Scope: TigerIQ AI Lab foundation, Web Control, PC01 runtime, multi-AI workforce, remote browser access
MAIN/Production: no automatic merge/deploy authorization

## Architecture locked for this roadmap

- PC01 is the primary Source/runtime node for TigerIQ AI Lab and TigerIQ Driver.
- Core execution loop remains: Goal → Decompose → Queue → Mission → Worker → Verify → Evidence → DONE → auto-claim next eligible goal.
- Cloudflare Tunnel + Access is the preferred browser-access path from outside PC01; no VPN client is required on the daily-use phone.
- Tailscale remains technical/emergency access only, not the daily mobile access path.
- Vercel is secondary: preview/backup/launcher only, not the primary runtime.
- Web Control becomes the control plane over PC01 state/queue/workers; it must not directly bypass authorization or safety policy.
- All external model calls go through one AI Gateway. Product modules must not hard-code direct provider calls.
- API secrets stay on PC01/server-side only; never in frontend, GitHub, Vercel client bundles or evidence logs.
- Empty queues do not invent Owner goals.
- Paid, irreversible, security-sensitive, financial and Production actions remain authorization-gated.

## Continuous execution order

### Phase A — State and continuous runtime foundation

1. Update Source of Truth and architecture decisions.
2. Finish WO-065 Continuous Operations physical PC01 gate.
3. Durable State + Event Journal for Goal/Mission/Task/Worker/Evidence.
4. Recovery + Watchdog: startup, crash recovery, retry, timeout and stuck detection.
5. Project Isolation: AI Lab and Driver have separate queue/state/evidence/runtime boundaries.
6. Secret Vault foundation on PC01.

### Phase B — Massive Multi-AI workforce

7. AI Provider Registry: Ollama/local plus external providers.
8. AI Gateway: one normalized interface for every provider/model.
9. Model Router: capability, quality, speed, quota, cost and fallback routing.
10. AI Employee Registry: Chief/Architect/Researcher/Coder/Tester/Reviewer/Judge and future roles.
11. Massive Parallel Scheduler: decompose one Goal into many independent/dependent tasks and maximize safe concurrency.
12. Concurrency + Quota + Cost Guard: provider limits, token budgets, rate limits and authorization thresholds.
13. Reviewer Swarm: independent cross-model review; author model cannot be sole approver for gated work.
14. Judge / Final Gate: PASS / FIX / BLOCKED / AUTHORIZATION decisions.
15. Evidence Engine: tests, outputs, commits, reviewer/judge results and machine-readable proof before DONE.

### Phase C — Web Control Center

16. Web Control backend reads live PC01 queue/state/worker/provider/evidence data.
17. Web Control UI target: >=95% visual fidelity to the approved TigerIQ Control Center mockup, with 100% real functional data paths rather than fake dashboard values.
18. Required Web modules:
   - Overview / system health
   - AI Workforce
   - Project + Task Graph
   - Live Queue
   - AI Providers / API Center
   - Authorization Center
   - Evidence & Result
   - Cost / Quota
   - Pause / Resume / Retry / Priority controls
19. Mobile-first PWA mode for iPhone/iPad/browser control.

### Phase D — Internet access and infrastructure

20. Cloudflare Tunnel publishes the required PC01 web services without inbound router port exposure.
21. Cloudflare Access protects public hostnames and provides browser-based authentication.
22. Vercel is reduced to preview/backup/launcher; no primary TigerIQ runtime dependency.
23. Tailscale is retained only for trusted technical/emergency administration.
24. PC02 standby/backup state design to reduce PC01 single-point-of-failure risk.

### Phase E — Physical integration and API onboarding

25. One-shot PC01 Foundation install + E2E gate covering runtime, restart/recovery, queue continuation, authorization holds and evidence.
26. Add real API providers one by one through the Gateway; each provider must pass connectivity, quota/rate-limit, routing and failure/fallback tests before entering the workforce pool.
27. Benchmark models/providers by work type and progressively increase concurrency.
28. Massive-AI E2E on a real project: Goal → decomposition → parallel multi-provider workers → tests → cross-review → judge → evidence → DONE.
29. Stabilization: performance, reliability, cost/quality routing, failure recovery, UI accuracy and operational evidence.

## Continuous runtime target

GOAL
→ DECOMPOSE
→ PRIORITIZE
→ DEPENDENCY GRAPH
→ PARALLEL SCHEDULE
→ AI GATEWAY
→ MULTI-PROVIDER EMPLOYEE POOL
→ EXECUTE
→ TEST
→ CROSS-REVIEW
→ JUDGE
→ EVIDENCE
→ DONE
→ AUTO-CLAIM NEXT ELIGIBLE GOAL

## Execution policy

- Execute safe/reversible feature-branch work continuously without per-step approval.
- Fix failures then retest; do not mark PASS from implementation alone.
- Stop only for a real blocker, physical PC01/Admin step, secret/API credential input, paid action, Production/release authorization, or irreversible/security-sensitive action.
- MAIN/Production remain untouched until explicit Owner authorization.
- OpenClaw remains outside this roadmap unless explicitly reopened.

## Immediate next milestone

Repository and documentation foundation are ready. The next physical milestone is a machine-readable WO-065 PC01 E2E evidence file with allPass=true. After the physical foundation gate, continue through Durable State/Recovery and then Multi-AI Gateway/Workforce before onboarding real provider API keys.
