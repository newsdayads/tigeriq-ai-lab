# Current State

Date: 2026-08-31

TigerIQ AI Lab is being operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Current MAIN baseline
- Repository: `newsdayads/tigeriq-ai-lab`.
- Production Web Control: `https://tigeriq-ai-lab.vercel.app`.
- MAIN before active WO-036 branch: `8882d2ed8995ea4d4c6344b2e78a01a45dbdaeba` (WO-035 merge).
- WO-035 made the installed Web Control/PWA entry prefer the executive Command Center; exact-head CI, Queue Hygiene and Vercel Verify passed before merge. Production deployment and the user's installed-PWA visual refresh remain separate gates until observed.
- Canonical PC01 canary queue remains #57/#58; no test/canary issue should be created merely for smoke testing.

## Operating model — P0
Owner -> Chief of Staff -> Department Heads -> Team Leads -> multiple AI/device employees -> Independent Reviewer -> Judge/Gate -> Evidence/State -> Chief -> Owner.

Operational rule: audit actual state -> select highest-value safe work -> execute -> independent review/judge -> record evidence/state -> immediately take the next safe work. Owner intervention is reserved for priority/limit/stop or an unavoidable human authorization/device gate.

## Verified distributed-workforce software
WO-024 through WO-030 established:
- organization hierarchy, Workforce/Node Registry and capability-aware scheduling;
- Task Packet + Result/Evidence contracts, concurrency, idempotency, retry/reassignment, lease timeout and restart recovery;
- durable PC01-oriented FileJournal state and hash-chain evidence boundary;
- scoped node credentials with raw bearer tokens never persisted;
- Android-compatible P-256/SHA256 pairing proof;
- private Workforce Controller API for pairing, employee enrollment, heartbeat, task lease and result return;
- buildable Android Worker with Android Keystore identity, foreground runtime, secure credential store and Accessibility bridge skeleton;
- Farm Gateway adapter boundary around ADB/UiAutomator-style primitives;
- simulator/CI proof of parallel workers and independent Reviewer/Judge.

WO-031 added the executive Workforce/Company Command Center with evidence-based progress rather than AI-estimated percentages.

WO-032 added the Z Flip 7 pilot employee UI/profile and produced an installable Android artifact.

WO-034 (PR #97, exact head `e47686ca699e00da4aeaec52771c5568ed9aef27`) passed CI + Android Worker + Queue Hygiene + Vercel Verify and merged as `731436be054e06cfdfe4b4d48e25507ab7adb35a`. It added:
- one-tap trusted Controller pairing from the Android Worker;
- default private Controller target `http://100.97.23.87:8790` with fail-closed URL policy;
- cleartext HTTP permission limited to the exact PC01 Tailscale address while public/arbitrary HTTP remains blocked;
- node-scoped employee self-enrollment without embedding the Controller admin secret in the phone;
- periodic authenticated heartbeat once paired;
- Worker version `0.3.0-pairing` and a successful APK artifact build.

WO-035 (PR #99, exact head `586e3358b883cc5b720717ad82415b7063b8a688`) passed CI + Queue Hygiene + Vercel Verify and merged as `8882d2ed8995ea4d4c6344b2e78a01a45dbdaeba`. It reconciles the installed PWA/legacy `/index.html` entry toward the executive Command Center while preserving the explicit Chat route and network-only service worker behavior.

## First physical Android evidence — EMP-001
A real Samsung Z Flip 7 has run TigerIQ Worker. Physical screenshot evidence observed in the owner session confirms only these gates:
- employee profile `EMP-001 / Research / Researcher / Gemini`;
- Device identity `READY`;
- Worker runtime `ACTIVE`;
- Accessibility `ON`;
- Controller pairing still `CHƯA GHÉP` at that evidence point.

The private screenshot itself is not stored in the repository. This evidence does **not** prove Controller heartbeat, task execution or Gemini prompt/result automation.

## Active priority — WO-036
Prepare a single-action PC01 Workforce Controller deployment package so the next physical gate can be performed without a chain of manual commands:
1. explicit private/Tailscale bind on `100.97.23.87:8790`;
2. durable journal under `F:\\TigerIQ\\State\\workforce.jsonl`;
3. locally generated admin secret outside source control with restricted ACL;
4. startup Scheduled Task under SYSTEM, independent of interactive logon;
5. Tailscale-restricted Windows Firewall rule;
6. redacted health/audit and non-destructive rollback scripts;
7. CI syntax/security gates before merge.

Merge of WO-036 will mean `READY_FOR_PC01_TEST`, not physical deployment PASS.

## Next physical gate
When the owner resumes, the intended bundled path is:
1. deploy/verify the Workforce Controller on PC01 once;
2. update the existing Z Flip 7 Worker to the successful `0.3.0-pairing` artifact;
3. ensure phone and PC01 are reachable on the private/Tailscale network;
4. press `Ghép Controller` on the Worker;
5. require live heartbeat/status evidence before marking `EMP-001 ONLINE`.

After that: lease one safe test task -> return structured result/evidence -> independently review it. Gemini UI prompt/result automation remains a separate provider-specific real-device gate and must not be claimed before evidence.

## External/deferred boundaries
- PC01 live status must be re-verified; software/CI does not equal PC01 runtime deployment.
- Vercel AI Gateway conversational inference still has the previously observed billing/card prerequisite; do not idle on it while other safe work exists.
- No provider credentials, owner credentials or secrets may enter source control.
- Consumer AI app automation must remain provider-specific, narrowly scoped and enabled only where technically and contractually appropriate.
- If one physical/login/2FA/billing path blocks, record the gate and continue another safe backlog item rather than idling.
