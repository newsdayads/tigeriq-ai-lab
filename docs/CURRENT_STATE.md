# Current State

Date: 2026-08-31

TigerIQ AI Lab is being operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Current MAIN baseline
- Repository: `newsdayads/tigeriq-ai-lab`.
- Current MAIN: `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042 merge).
- Production Web Control: `https://tigeriq-ai-lab.vercel.app`.
- Latest verified Production deployment is still MAIN SHA `69ef75149155c09d4618afef941e54cf02feaf79`; no WO-045 promotion/release is claimed.
- Canonical PC01 real deployment job remains issue #100. PC01 runtime is currently deferred by Owner instruction for Web-only hardening; do not create duplicates and do not infer PC01/Tailscale runtime state.
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

## Active priority — WO-040 baseline retained on MAIN history
WO-040 added a narrow fail-closed provider-policy boundary for the future `gemini-android-ui` adapter. The policy may return `READY_FOR_REAL_DEVICE_PROVIDER_TEST` only after evidence flags show a verified physical Controller, real device pairing, fresh heartbeat, stable-signed Worker continuity, Accessibility enabled, an already-authenticated provider session and explicit provider-automation authorization.

The gate permits only bounded `research.prompt` tasks. It rejects unattended login/2FA, payment/billing, credential mutation and unsupported task kinds. WO-040 does not perform third-party UI actions and must never be reported as Gemini execution proof.

## Web Control — WO-045 release candidate hardening
- Scope remains Web Control only; APP, AI Coordinator, PC01 runtime and Work Management are excluded except for interface compatibility.
- Active PR is #117 on `wo045/web-control-remote-ops`; MAIN/Production are unchanged by this candidate.
- Latest Web runtime-changing commit is `1d920b0a865a3b8ee35d3c4d4d5ea8a966e8f7ba`. Vercel Preview `dpl_BR7C7U4KhpnRbbFnF5c5U5ai5rZw` is READY for that commit.
- Repository compare from runtime commit `1d920b0a865a3b8ee35d3c4d4d5ea8a966e8f7ba` through pre-state-update head `3d1f6a77cc76e131c2c9f18434dca7e6894b5a69` changes only `docs/CURRENT_STATE.md`, `scripts/verify_queue_hygiene.mjs`, `tests/web-control-pc01-contract.test.mjs`, and `tests/web-control-security-dedupe-gates.test.mjs`; no `api/`, `public/`, `vercel.json`, or other Web runtime source changed after `1d920b0a...`.
- Pre-state-update exact head `3d1f6a77cc76e131c2c9f18434dca7e6894b5a69` passed CI #251, Queue Hygiene #178 and WO-012/013 Vercel Online Verify #152. This documentation reconciliation is non-runtime and intentionally retriggers final exact-head gates.
- Security/correctness fixes implemented on the branch include Owner-authenticated browser writes with server-side GitHub credential only, OAuth multi-cookie preservation, Work Order dedupe including concurrent same-process double-submit, canonical canary reuse, and fail-closed completion requiring concrete RESULT evidence followed by trusted independent REVIEW_PASS and trusted JUDGE_PASS.
- Issue closure alone is never completion. Closed work lacking the required proof remains `closed_unverified`; open work may remain `evidence_pending`, `review_pending`, or `gate_pending`.
- The only previously recorded independent Web review was a FAIL on historical head `0988c2cecc21583ae3e6c9b53d650198325f7d9e`; its two actionable findings (OAuth Set-Cookie overwrite and browser GitHub-token write bypass) were fixed afterward. That historical FAIL is not a PASS for the current branch.
- Fresh independent review must target the final exact PR head after this evidence reconciliation and must independently verify Owner auth boundary, OAuth callback/session continuity, dedupe, canary reuse, lifecycle proof ordering/provenance, and the non-runtime-only delta after `1d920b0a...`.
- Real external Owner Google OAuth provider/environment smoke is still required before release. Repository/unit tests do not substitute for that runtime smoke.
- PC01 physical/runtime work is explicitly deferred and is not a blocker for this Web-only release-candidate hardening pass.

## Web Control release gate
Do not merge PR #117, modify MAIN, promote Production, or release WO-045 until all of the following are true on the final exact PR head:
1. CI PASS;
2. Queue Hygiene PASS;
3. WO-012/013 Vercel invariant PASS;
4. fresh independent Web Control review PASS on that exact head;
5. real Owner Google OAuth runtime smoke PASS in an actually configured provider/environment;
6. explicit Owner instruction to publish/release.

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
- PC01/Tailscale live state must always be re-verified; repository software/CI is not runtime proof.
- Vercel filesystem is stateless and is never durable Workforce storage.
- Vercel AI Gateway billing/card and paid/provider credential activation are not authorized work items.
- No provider credentials, owner credentials, signing secrets or private keys may enter source control.
- Consumer AI app automation must remain provider-specific, narrowly scoped and enabled only where technically and contractually appropriate.
- If one physical/login/2FA/billing path blocks, record the gate and continue another safe backlog item.
