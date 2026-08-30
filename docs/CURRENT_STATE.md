# Current State

Date: 2026-08-30

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production baseline
- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- Latest completed remote Work Order: WO-025 — Workforce Controller Phase 1.
- WO-024 remote Workforce core is merged and retained.
- WO-025 MAIN merge: `7e2a437f95f814bdd9a2de6a2287fce3a0e217fd`.
- WO-025 Production deployment `dpl_6pVY9C3P2hqqB9y1Uq62wq3PVdQE`: READY and aligned to the merge SHA.
- Canonical Production `/api/control`: HTTP 200 after deployment; Vercel/GitHub and existing Web Control behavior remain healthy.
- Canonical PC01 queue remains exactly #57/#58. No duplicate canary was created.
- No live PC01/OpenClaw/Ollama recovery is claimed.

## Company operating direction — P0
TigerIQ is being developed as a continuous distributed AI company rather than a single assistant waiting for Owner commands.

Operating model:
Owner -> Chief of Staff -> Department Heads -> Team Leads -> multiple AI/device employees -> Independent Reviewer -> Judge/Gate -> Evidence -> Chief -> Owner.

Operational rule: audit real state -> select highest-value safe work -> execute -> review/judge -> record evidence/state -> immediately take the next work. Owner intervention is for priority changes, limits, gated authorization or stop.

## Verified Workforce capabilities in MAIN
From WO-024:
- organization hierarchy, Workforce/Node Registry, heartbeat and employee metrics;
- Task Packet, Result/Evidence schemas, capability scheduling, concurrency, retry/reassignment and canonical idempotency;
- state-store/restart boundary and simulator proof of two parallel workers -> independent Reviewer -> independent Judge;
- read-only Workforce status projection;
- secure pairing primitive and Android Worker execution contract.

From WO-025:
- zero-cost FileJournal Workforce backend for PC01/Farm Controller with append-only JSONL, flush-to-disk, file locking, optimistic concurrency and SHA-256 hash chain;
- file-backed restart recovery and duplicate suppression tests;
- durable scoped node credential store; raw bearer token is never persisted, only its hash;
- Android-compatible P-256/SHA256 ECDSA pairing proof verification;
- private Workforce Controller API for status, pairing challenge, node pairing, employee provisioning and authenticated heartbeat;
- standalone `workforce-controller` runtime using `F:\TigerIQ\State\workforce.jsonl` by default;
- wildcard public network bind is forbidden.

Exact WO-025 evidence is in `docs/work-orders/WO-025-WORKFORCE-CONTROLLER-PHASE1.md`.

## Existing remote capability retained
- deterministic Work Order dedupe and lifecycle/status evidence;
- explicit dispatch fallback and evidence-first Work Board;
- mobile/PWA Web Control;
- Provider Mesh v2 engineering path;
- governance/evidence hygiene.

## External/deferred activation boundaries
- Vercel AI Gateway conversational Chief still has the previously observed billing/card prerequisite; do not idle on it while other work exists.
- Live cloud provider calls require authorized runtime credentials/model configuration and applicable financial authorization.
- No physical Android worker is paired or controlled yet. Real-device activation needs a one-time install/pairing/Accessibility/login step on selected phones.
- Consumer AI app automation must remain provider-specific and enabled only where technically/account-policy appropriate.
- PC01 runtime installation of the new Workforce Controller is not claimed; the controller is software/CI verified only.

## Active next priority — Android Workforce execution
Continue autonomously without waiting for Owner messages:
1. implement durable remote task mailbox with lease token/deadline/result acceptance and stale-result rejection;
2. build TigerIQ Worker Android project with Keystore identity, encrypted local credential storage, pairing, foreground heartbeat, task polling/result publishing, watchdog and AccessibilityService bridge;
3. add Android CI build producing a debug APK artifact without claiming real-device execution;
4. add mobile Workforce Board to Web Control;
5. implement Farm Gateway ADB/Appium/UiAutomator2 inventory/control adapter;
6. prepare one bundled two-phone provisioning action; then run physical gate: pair + heartbeat + two concurrent jobs + evidence + independent review + disconnect/restart recovery;
7. after physical PASS, scale-test 5/10/20 workers and add department planner/KPI routing.

If one path reaches an unavoidable physical/login/2FA/billing/credential boundary, record it and continue another safe backlog path instead of idling.
