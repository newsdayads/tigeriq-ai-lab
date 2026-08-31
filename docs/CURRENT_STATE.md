# Current State

Date: 2026-08-31

TigerIQ AI Lab is operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Current MAIN / Production truth
- Repository: `newsdayads/tigeriq-ai-lab`.
- Audited MAIN head: `4d73bd923526aa3396a4f436332a9b863c66e172` (WO-042 secure Owner Web Control login).
- WO-040 merged as `69ef75149155c09d4618afef941e54cf02feaf79`.
- WO-041 merged as `d0b085c10a691d7c1dd41a2861253c96f5f85215`.
- WO-042 merged as `4d73bd923526aa3396a4f436332a9b863c66e172`.
- Latest observed Vercel Production deployment is still `69ef75149155c09d4618afef941e54cf02feaf79` (WO-040). MAIN is ahead of Production; do not claim WO-041/WO-042 are live in Production until a real production deployment is observed.
- Vercel Hobby deployment quota has been observed in this operating window. Do not retry/spam deployments, do not pay/upgrade, and continue non-Vercel work while quota is constrained.
- MAIN currently has no branch protection/ruleset enforcement. This is an open governance defect tracked by #113; do not treat mergeability as proof that gates are enforced.

## Canonical PC01 / device truth
- Issue #100 remains the single canonical physical Workforce Controller deployment job. At this audit it has zero comments and therefore no CLAIM/RESULT evidence.
- Issue #58 remains the canonical deterministic PC01 autonomy canary. At this audit there is no accepted CLAIM/RESULT evidence proving consumption.
- Issue #57 remains the canonical PC01 control-plane recovery work order; do not create duplicate recovery/canary issues.
- Repository/CI evidence is not PC01/Tailscale runtime evidence. Never infer a live listener, heartbeat, pairing or durable PC01 state without direct runtime evidence.
- Real-device evidence remains bounded: a Z Flip 7 has run TigerIQ Worker with identity/runtime/Accessibility evidence, but Controller pairing/heartbeat/task-result/Gemini execution are not proven by that evidence alone.

## Verified Workforce software baseline
WO-024 through WO-030 established the durable Workforce contracts and Controller/Worker foundations: organization hierarchy, node registry and capability scheduling; Task Packet/Result/Evidence contracts; concurrency, idempotency, bounded retries and lease recovery; PC01-oriented FileJournal durability/hash-chain evidence; scoped credentials; P-256 pairing proof; private Workforce Controller API; Android Worker with Android Keystore identity, foreground runtime, secure credential store and Accessibility bridge skeleton; Farm Gateway adapter boundary; and simulator/CI proof of parallel workers and independent Reviewer/Judge behavior.

WO-031 added the executive Workforce/Company Command Center. WO-032 added the Z Flip 7 pilot employee UI/profile and buildable Android artifact. WO-034 added trusted Controller pairing, tailnet-scoped Controller URL policy, employee self-enrollment and authenticated heartbeat. WO-035 made the Command Center the preferred installed-PWA entry.

WO-036 merged as `68fd2bedea380321c7d7ac77c0b7481fdda20e75` and remains software-gated `READY_FOR_PC01_TEST`; it is not PC01 deployment proof.

WO-037 merged as `793899a628be46d0d4e9292804ad674379b2a42e` and established stable-signing configuration plus disposable CI certificate-continuity proof. It does not prove the private physical stable key exists.

WO-038 merged as `0d25210488bff58ee9902da203bb2b08697749cd` and added the fail-closed stable-signed Worker release bundle. It means `READY_FOR_STABLE_SIGNED_RELEASE_BUILD`, not physical build/install PASS.

WO-039 merged as `d01dcd2483d2f6b91c4c8282927e009e7416a18b` and deterministically proves the generic EMP-001 Controller protocol in software: pairing proof, enrollment, heartbeat, task lease, structured result/evidence and completed status projection. It is simulator/repository evidence only.

WO-040 merged as `69ef75149155c09d4618afef941e54cf02feaf79` and adds the fail-closed provider-policy boundary for future `gemini-android-ui` execution. It permits only bounded supported tasks after required real-device evidence flags are satisfied; it is not Gemini execution proof.

WO-041 merged as `d0b085c10a691d7c1dd41a2861253c96f5f85215` and redesigns Z Flip 7 Worker onboarding. Repository gates passed; no new Controller or Gemini runtime claim is implied.

WO-042 merged as `4d73bd923526aa3396a4f436332a9b863c66e172` and adds secure Owner Web Control login. Owner auth remains fail-closed until its real deployment/environment configuration is verified.

## Active remote-safe work streams
The audit currently shows these open PRs and they must remain isolated until their own exact-head gates and governance requirements are satisfied:
- #109 — phone-first Android Worker; physical Z Flip 7 smoke remains required before release claims.
- #111 — AI Coordinator; must not overwrite/conflict with PC01 recovery worker and still requires independent review/gate.
- #115 — Work Management system; exact-head CI evidence exists in its tracking issue, but independent review and release gate remain required.
- #116 — PC01 worker security hardening; repository proof must not be reported as installed PC01 runtime proof.
- #117 — unified Web Control remote operations; Vercel/production release remains separate from repository implementation.

Governance audit #113 is P0 because MAIN currently lacks enforced branch protection/ruleset, merge-SHA CI coverage and machine-verifiable independent review enforcement. Reconcile shared state carefully so parallel branches do not overwrite each other.

## Physical evidence sequence toward EMP-001 real operation
1. Restore/verify canonical PC01 autonomous ingress through #57/#58 without duplicate canaries.
2. Execute canonical #100 and require real private listener/status/recovery evidence.
3. Provision the stable Android signing identity once if absent, using private runtime storage only.
4. Build the stable-signed Worker release through the WO-038 bundle and verify certificate continuity.
5. Install/update the pilot device(s), pair EMP-001 to Controller and require fresh heartbeat/status evidence.
6. Lease one safe generic task, return structured result/evidence and complete independent review/judge.
7. Only after those gates may the WO-040 provider-policy gate authorize a narrowly scoped real-device Gemini adapter test.

## External / deferred boundaries
- Vercel filesystem is stateless and is never durable Workforce storage; PC01/Farm Controller remains the durable operational authority.
- Vercel AI Gateway billing/card actions and paid/provider credential activation are not authorized.
- No provider credentials, Owner credentials, signing secrets or private keys may enter source control, logs or public artifacts.
- Consumer AI app automation must remain provider-specific, narrowly scoped and technically/contractually permitted.
- If physical install/UAC/login/2FA is the only blocker for one path, record the gate and continue other safe remote work.
