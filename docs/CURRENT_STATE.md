# Current State

Date: 2026-08-31

TigerIQ AI Lab is being operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Current MAIN baseline
- Repository: `newsdayads/tigeriq-ai-lab`.
- Production Web Control: `https://tigeriq-ai-lab.vercel.app`.
- MAIN before active WO-038 branch: `793899a628be46d0d4e9292804ad674379b2a42e` (WO-037 merge).
- Canonical PC01 real deployment job remains issue #100. It has no claim/result evidence at this state point; do not create duplicates and do not infer PC01/Tailscale runtime state.
- Vercel Hobby has the known daily deployment quota condition `api-deployments-free-per-day`; do not retry/spam deployments or pay/upgrade. Non-Vercel work continues.

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

WO-037 PR #102 exact head `b5b91936cc5e372ae85cf85c2832f40cbcd03602` passed CI, Android Worker stable-signing proof, Queue Hygiene and applicable Vercel Verify, then merged as `793899a628be46d0d4e9292804ad674379b2a42e`. It establishes:
- private stable signing material only under `F:\TigerIQ\Secrets\android-worker-signing`;
- Gradle path-only signing inputs with fail-closed partial configuration;
- keyless normal CI plus a disposable CI-only identity proving two consecutive signed builds reuse one certificate;
- a PC01 provisioning script that creates/pins the real stable certificate without printing secrets.

WO-037 merge means `READY_FOR_STABLE_SIGNING_PROVISION`; it does not prove the physical TigerIQ keystore exists or any device uses it.

## First physical Android evidence — EMP-001
A real Samsung Z Flip 7 has run TigerIQ Worker. Physical screenshot evidence observed in the owner session confirms only:
- employee profile `EMP-001 / Research / Researcher / Gemini`;
- Device identity `READY`;
- Worker runtime `ACTIVE`;
- Accessibility `ON`;
- Controller pairing was `CHƯA GHÉP` at that evidence point.

This does not prove Controller heartbeat, task execution or Gemini prompt/result automation.

## Active priority — WO-038
Build the stable-signed Worker release path without requiring PC01 interaction during unattended work:
1. consume only WO-037 private signing paths;
2. build Android `assembleRelease` locally on PC01 when the key exists;
3. verify APK signature/certificate with `apksigner` against the pinned SHA-256 fingerprint;
4. reject any identity mismatch;
5. emit only the APK plus a redacted SHA-256/certificate/source manifest under `F:\TigerIQ\Releases\android-worker\<version>`;
6. never copy passwords or keystore material into release output.

Merge of WO-038 will mean `READY_FOR_STABLE_SIGNED_RELEASE_BUILD`, not physical build/install PASS.

## Physical/next gates
When physical access resumes, the intended evidence sequence is:
1. execute canonical #100 and require real private listener/status evidence from PC01;
2. provision the stable Android signing identity once if absent;
3. build the stable-signed Worker release through the WO-038 bundle;
4. install/update the pilot device(s) and verify the installed certificate/application continuity;
5. pair EMP-001 to Controller and require live heartbeat/status evidence;
6. lease one safe task -> return structured result/evidence -> independent review.

A narrowly scoped Gemini adapter remains after the generic task/evidence path is proven. Never claim Gemini prompt/result automation before real-device evidence and provider-policy checks.

## External/deferred boundaries
- PC01/Tailscale live state must always be re-verified; repository software/CI is not runtime proof.
- Vercel filesystem is stateless and is never durable Workforce storage.
- Vercel AI Gateway billing/card and paid/provider credential activation are not authorized work items.
- No provider credentials, owner credentials, signing secrets or private keys may enter source control.
- Consumer AI app automation must remain provider-specific, narrowly scoped and enabled only where technically and contractually appropriate.
- If one physical/login/2FA/billing path blocks, record the gate and continue another safe backlog item.
