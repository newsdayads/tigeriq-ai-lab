# Current State

Date: 2026-09-04

TigerIQ AI Lab is being operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## 2026-09-04 PC01 OpenClaw Control state — P0 BLOCKER
- OpenClaw Control UI is reachable in Chrome at `http://127.0.0.1:18789/chat`.
- The UI targets `ws://127.0.0.1:18789` but reports that the browser cannot complete the Gateway connection.
- A working authenticated Control session is **not verified**.
- Token persistence, browser/device pairing persistence, auto-login, Gateway RPC health, and reboot recovery for this path are **not verified**.
- Multiple helper-script/dashboard attempts did not produce a successful session. The read-only audit attempt produced only its header, so it is not valid runtime/config evidence.
- Operational decision: stop blind trial-and-error on PC01 for this issue. Preserve current state and do not repeatedly restart services, regenerate tokens, create duplicate Gateway launch paths, or ask the Owner to continue interactive testing without a targeted fix backed by direct runtime evidence.
- Evidence: `docs/evidence/2026-09-04-openclaw-control-blocker.md`.
- Status: `BLOCKED / NOT PASS`.

## Current MAIN baseline
- Repository: `newsdayads/tigeriq-ai-lab`.
- MAIN observed on 2026-09-04: `011161f0b8263bdc534d12c1101bd1d55a76f8ea` (`safety(vercel): relock automatic production deployments`).
- Production Web Control: `https://tigeriq-ai-lab.vercel.app`.
- Canonical PC01 real deployment job remains issue #100. PC01/Tailscale/runtime state must not be inferred from repository state alone.
- Vercel automatic production deployment remains safety-locked unless an explicitly authorized release/verification path requires otherwise.

## Operating model — P0
Owner -> Chief of Staff -> Department Heads -> Team Leads -> multiple AI/device employees -> Independent Reviewer -> Judge/Gate -> Evidence/State -> Chief -> Owner.

Operational rule: audit actual state -> select highest-value safe work -> execute -> independent review/judge -> record evidence/state -> immediately take the next safe work. Owner intervention is reserved for priority/limit/stop or an unavoidable human authorization/device gate.

## Verified Workforce software
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

WO-031 added the executive Workforce/Company Command Center with evidence-based progress. WO-032 added the Z Flip 7 pilot employee UI/profile and installable Android artifact. WO-034 added one-tap trusted Controller pairing, tailnet-scoped Controller URL policy, employee self-enrollment and periodic authenticated heartbeat. WO-035 made the executive Command Center the preferred installed-PWA entry.

WO-036 merged as `68fd2bedea380321c7d7ac77c0b7481fdda20e75`. It provides the single-action PC01 Workforce Controller deployment package and is software-gated `READY_FOR_PC01_TEST` only. Issue #100 is the single canonical physical execution job.

WO-037 merged as `793899a628be46d0d4e9292804ad674379b2a42e`. It establishes private stable signing paths, fail-closed Gradle signing configuration, keyless normal CI, disposable CI certificate-continuity proof, and a PC01 stable-key provisioning script. It does not prove the physical stable key exists.

WO-038 merged as `0d25210488bff58ee9902da203bb2b08697749cd`. It adds the fail-closed stable-signed Android Worker release bundle: private signing inputs only, `assembleRelease`, `apksigner` certificate verification against the pinned fingerprint, and redacted APK/source/certificate manifest output. It means `READY_FOR_STABLE_SIGNED_RELEASE_BUILD`, not physical build/install PASS.

WO-039 merged as `d01dcd2483d2f6b91c4c8282927e009e7416a18b`. It deterministically proves the generic EMP-001 Controller protocol in software: P-256 pairing proof, employee enrollment, authenticated heartbeat, bounded task enqueue/lease, structured result/evidence publication and completed status projection. It is simulator/repository evidence only and is not proof of real PC01, real-device pairing, stable-signed installation or Gemini execution.

## First physical Android evidence — EMP-001
A real Samsung Z Flip 7 has run TigerIQ Worker. Physical screenshot evidence observed in the owner session confirms only:
- employee profile `EMP-001 / Research / Researcher / Gemini`;
- Device identity `READY`;
- Worker runtime `ACTIVE`;
- Accessibility `ON`;
- Controller pairing was `CHƯA GHÉP` at that evidence point.

This does not prove Controller heartbeat, task execution or Gemini prompt/result automation.

## Active software priority baseline — WO-040
Add a narrow fail-closed provider-policy boundary for the future `gemini-android-ui` adapter. The policy may return `READY_FOR_REAL_DEVICE_PROVIDER_TEST` only after evidence flags show a verified physical Controller, real device pairing, fresh heartbeat, stable-signed Worker continuity, Accessibility enabled, an already-authenticated provider session and explicit provider-automation authorization.

The gate permits only bounded `research.prompt` tasks. It rejects unattended login/2FA, payment/billing, credential mutation and unsupported task kinds. WO-040 does not perform third-party UI actions and must never be reported as Gemini execution proof.

## Physical/next gates
When physical access resumes, the intended evidence sequence is:
1. execute canonical #100 and require real private listener/status evidence from PC01;
2. provision the stable Android signing identity once if absent;
3. build the stable-signed Worker release through the WO-038 bundle;
4. install/update the pilot device(s) and verify installed certificate/application continuity;
5. pair EMP-001 to Controller and require live heartbeat/status evidence;
6. lease one safe generic task -> return structured result/evidence -> independent review;
7. only then evaluate the WO-040 provider-policy gate and, if eligible, test a narrowly scoped Gemini adapter under provider policy and real-device gates.

## External/deferred boundaries
- PC01/Tailscale/OpenClaw live state must always be re-verified; repository software/CI is not runtime proof.
- Vercel filesystem is stateless and is never durable Workforce storage.
- Vercel AI Gateway billing/card and paid/provider credential activation are not authorized work items.
- No provider credentials, owner credentials, signing secrets or private keys may enter source control.
- Consumer AI app automation must remain provider-specific, narrowly scoped and enabled only where technically and contractually appropriate.
- If one physical/login/2FA/billing path blocks, record the gate and continue another safe backlog item.
