# #1940 native PC01 execution — 2026-09-26

Status: REAL BLOCKER. Candidate live acceptance failed; rollback health passed. This is not a completion, merge, release, or three-worker PASS claim.

Current authority: APP_CHROME_RECOVERY_V1; CODEX_LOCAL_PC01; ONE_WRITER=true. All commands in this execution used native local PowerShell on PC01. No RDC, Remote Guard request/debug/change, credentials change, paid service, Production release, or direct-main edit.

## Verified work

- Candidate head: eea70521a9bedac701db218b0780ab0e7b3042c7.
- Unique STAGING copy and atomic finalize: 72 files, required files and VERSION PASS.
- Candidate tree SHA256: fdfdffe9b859886c5a62d201e45cb3828e13ffd355c76675636c7ee40e119233.
- Candidate bridge SHA256: 113a3945b6c118a091b3844596de856b1977fa711a531e9a791ffcd92ab478c1.
- Target PowerShell 5.1 parse: 6 scripts PASS. Node syntax: 25 files PASS.
- Exact candidate installer rollback fixture under STAGING: injected candidate-health failure, prior manifest restored, ROLLBACK=PASS. Service health and task operations were mocked in this fixture; it does not prove live restart.
- Original active root had zero files. Its recovery sibling contained the exact 72 files from independently downloaded successful CI run 36096417126 / artifact 10847117847, plus three rollback metadata files.
- Recovered a clean immutable baseline from that CI artifact. Baseline tree SHA256: e3f24e67c9da774a38ab46bbd8e03824f3ec44c6da16dfff15fd08651337ab80. Baseline bridge SHA256: 1c449dc9630dd9037c3b8c7a1509f32288ebb3ed729f7caf82fed41e4e6bcb1f.
- Backed up 2,053 durable Runtime files, Config, original recovery sibling, original manifest, task XML, and repository checkpoint. Transient lock/tmp files were excluded; earlier incomplete copy attempts were preserved. Backup remains local and is not uploaded.
- At 21:33:28 UTC, Controller, Bridge, and Broker all proved the recovered baseline head/hash/root.
- Existing candidate Install-ApprovedArtifact.ps1 activated eea70521, restarted TigerIQ APP Chrome Unified, and returned LIVE_VERIFIED at 21:34:36 UTC. All three service provenance checks passed. This was service provenance only.

## Live failure and rollback

NV02 failed the boot/local continuation model check with MODEL_CONTROL_NOT_EXACT_OR_UNIQUE; telemetry reported MODEL_SLUG_NOT_GPT_5_6_SOL. NV03 telemetry also showed an unverified model control. NV03/NV04 canaries were not accepted. No successful three-worker prompt/WORKING/anti-spam/F5/recovery/restart-continuity/reboot claim is made.

Paused through the local API and rolled back through an atomic active-manifest replacement plus the existing scheduled supervisor. At 21:37:58 UTC all three services proved the recovered baseline again, with paused=true and startupReady=true. The clean baseline tree was rehashed before rollback. Baseline restart/service recovery passed; candidate restart continuity and physical reboot were not tested.

Actual remaining LIVE:
- Head: ede7348d6d21cbad9d8b2afc92e8cd776c78fbdf.
- Root: D:\TigerIQ\Apps\ChromeController\LIVE\ede7348d6d21-recovered-20260925T213258590Z.
- State: paused, service health/provenance verified; old behavior is not accepted against the recovery SPEC.

## Confirmed second writer

After our baseline was verified at 21:33:28 UTC, the active pointer changed to a v1 manifest at 21:33:36.9566763 UTC, targeting Deploy-final-ede7348. This was outside this executor's operations.

The Core zero-touch staging backup at D:\TigerIQ\State\AppChromeInstall\ede7348-10847117847\rollback\active-deploy.json contains the exact recovered pointer we wrote at 21:33:07 UTC. This corroborates a concurrent zero-touch installation after our baseline repair. The candidate installer then captured that changed v1 pointer as its previous deployment; its missing tree anchor was rejected by our rollback preflight. Rollback instead used our independently hashed and previously live-verified immutable baseline.

D:\TigerIQ\State\appchrome-install-request.json still requests head ede7348 / artifact 10847117847 from open issue #1888. That issue still advertises APP_CHROME_DEPLOY_AUTHORIZED=true, ZERO_TOUCH_DEPLOY=true, and MUTATION_OWNER=VY_OWNER_AUTHORIZED. CoreUpdater invokes scripts/tigeriq-core/appchrome-zero-touch.ps1; that helper can discover the stale issue and does not participate in the candidate's deployment file lock. Its result/state continued updating during this execution.

Further deployment is blocked by the conflicting writer. No shared Core updater, security boundary, credentials, or authorization model was edited. Per #1967, an independent control-plane repair owner must reconcile the stale zero-touch writer with the current #1940 handoff before this affected executor resumes deployment.

## Resume contract

1. Independently retire/reconcile the stale #1888 AppChrome install request/discovery path and prove that Core cannot replace this scope's deployment while CODEX_LOCAL_PC01 owns it.
2. Codex Local then diagnoses the exact model controls on the intended worker tabs; fixes remain isolated in STAGING and require relevant tests/review.
3. Deploy a verified candidate through the approved installer and complete every requested live/lifecycle gate, rolling back on failure.
4. Only after live PASS synchronize the exact accepted running source through the branch/PR/gate path. This draft records failure evidence/checkpoint only; candidate source remains unaccepted and is not published as live.

Local evidence root: D:\TigerIQ\Apps\ChromeController\STAGING\evidence-1940-native-20260925T212655918Z.
Full durable backup: D:\TigerIQ\Apps\ChromeController\BACKUP\pre-native-recovery-20260925T213258590Z.
Runtime checkpoint: D:\TigerIQ\Apps\ChromeController\Runtime\APP_CHROME_WORK_STATE.json.