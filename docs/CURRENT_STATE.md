# Current State

Date: 2026-08-31

TigerIQ AI Lab Production Web Control is online in the isolated `newsdayads/tigeriq-ai-lab` / Vercel `tigeriq-ai-lab` stack. Tiger IQ Driver remains isolated and unchanged.

## Production / MAIN baseline
- Production URL: `https://tigeriq-ai-lab.vercel.app`.
- Latest completed remote engineering Work Order in MAIN: WO-028 — Farm Gateway adapter boundary.
- MAIN SHA after WO-028 merge: `53b191935277effe9121c3b807d5617f49d10db3`.
- Latest Vercel-affecting Production deployment remains WO-027 deployment `dpl_4dQ8ngBi4ogiSraGJBHitkC1bLsQ`, READY at merge SHA `eeff17c2ffdea30d8c82fbab3ab8a7478dd64efa`.
- WO-028 changed package/test code only; no newer Production deployment was observed. This is not treated as an error or as evidence that Vercel deployed WO-028.
- Canonical Production `/api/control`: HTTP 200 after WO-028 merge; existing Web Control behavior remains healthy.
- Canonical PC01 queue remains exactly #57/#58. No duplicate canary was created.
- No live PC01/OpenClaw/Ollama recovery or physical Android execution is claimed.

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
- standalone `workforce-controller` runtime using `F:\\TigerIQ\\State\\workforce.jsonl` by default;
- wildcard public network bind is forbidden.

From WO-026:
- durable Android/remote worker task mailbox with bounded attempts;
- short-lived lease token and deadline; raw lease token is not persisted;
- restart recovery, expired-lease requeue and re-lease within remaining attempts;
- stale/expired lease results are rejected;
- successful result acceptance is idempotent and single-result authoritative;
- PR #85 exact head `09aeb3fc5b83ed04a09aad9bffa96efadccb6bdc` passed CI, Queue Hygiene and Vercel Verify before merge;
- MAIN merge SHA `6c7b8510016f860db7631e481ca5ce87a72b109f`; Vercel Production deployment `dpl_FmiZLAVobDUruH7ehn7vNAmhvmgN` was READY at that SHA.

From WO-027:
- buildable Android Worker MVP with applicationId `ai.tigeriq.worker`, Android 35/minSdk26;
- device-local Android Keystore P-256 identity;
- persistent foreground worker service skeleton and safe AccessibilityService semantic bridge skeleton;
- explicit Android permissions/resources and dedicated Android CI APK artifact build;
- original stacked PR #86 was closed without merge after WO-026 squash changed its base; clean replacement PR #87 contained only 11 Android Worker files;
- PR #87 exact head `e824dddf577efd6bf378c9fbba760b4ddf6a9f78` passed CI, Queue Hygiene, Vercel Verify, Android Worker APK build and Preview READY;
- MAIN merge SHA `eeff17c2ffdea30d8c82fbab3ab8a7478dd64efa`; Production deployment `dpl_4dQ8ngBi4ogiSraGJBHitkC1bLsQ` is READY at that SHA.

From WO-028:
- typed Farm Gateway adapter boundary around ADB/UiAutomator2-style primitives;
- deterministic `adb devices -l` inventory parsing and device-state/capability mapping;
- command runner uses command + argv + bounded timeout rather than shell command strings;
- fail-closed app restart and screenshot capture; evidence path constrained under `/sdcard/`;
- tests cover inventory parsing, argv isolation, injection sanitization/path confinement and ADB failure;
- protocol version `1` provides an explicit compatibility boundary;
- PR #88 exact head `5d343a28dcf00bfd23872ee5d16582c7f5feb557` passed CI run `33332971625`, Queue Hygiene `33332971736` and Vercel Verify `33332971696` before merge;
- MAIN merge SHA `53b191935277effe9121c3b807d5617f49d10db3`.

## External/deferred activation boundaries
- Vercel AI Gateway conversational Chief still has the previously observed billing/card prerequisite; do not idle on it while other work exists.
- Live cloud provider calls require authorized runtime credentials/model configuration and applicable financial authorization.
- No physical Android worker is paired or controlled yet. Real-device activation needs a one-time install/pairing/Accessibility/login step on selected phones.
- Consumer AI app automation must remain provider-specific and enabled only where technically/account-policy appropriate.
- PC01 runtime installation of Workforce Controller/Farm Gateway is not claimed; those components are software/CI verified only.

## Active next priority — Android Workforce execution
Continue autonomously without waiting for Owner messages:
1. implement Android Worker controller client: secure pairing flow, local encrypted/scoped credential handling, authenticated heartbeat, task lease polling/acknowledgement, result/evidence publishing and bounded watchdog/recovery;
2. add mobile Workforce Board to Web Control using stateless Vercel status contracts, without making Vercel the durable Workforce authority;
3. add a concrete PC01-side Farm Gateway command-runner/runtime wrapper as software/CI only, without interacting with PC01 during unattended work;
4. prepare one bundled two-phone provisioning action and mark `READY_FOR_DEVICE_TEST` when remote prerequisites are complete;
5. after physical PASS, scale-test 5/10/20 workers and add department planner/KPI/performance routing.

If one path reaches an unavoidable physical/login/2FA/billing/credential boundary, record it and continue another safe backlog path instead of idling.
