# UltraCar v57 — source-only release safety packet

Scope: Work Order #5129, Owner-approved **TEST** only. This packet does not and cannot grant PC01 host write permission.

## Required unblock before any actual v57 release
1. **Authorized host/provider edit** must explicitly permit version metadata on **isolated** stage `Staged_v1_0_57_CockpitAlignedQuickbar_298`, `apktool.yml`: code `298`, name `TigerIQ_HCM_v1.0.57`; update original Profile string. Prior attempts to edit those exact files via RDC were upstream DENIED. Do not replay the denied mutation using a different account, tool, syntax or executor.
2. **Authorized runner maintenance** must remove signed-file deletion and pin candidate filename/version/certificate. Source-file corrections cannot silently patch `D:\TigerIQ\Tools\sign_latest.ps1` or `sync_latest_ultracar_to_drive.ps1` on PC01. Keep verified backups. No changes to prior signed APK.
3. **Once genuine permission exists:** build isolated fresh code298 APK, Zipalign and verify, sign exact new candidate through approved runner, verify v2/v3 signature and original signer cert, trigger existing *interactive* task `TigerIQ_UltraCar_Sync_Drive`; do not call Drive sync directly from SYSTEM. Sync selects only exact `_signed_TEST.apk` (never `unsigned`); reject mismatched existing hash, and prove Drive ID/parent/size/hash.
4. Samsung Z Fold 2 / DeX physical QA is separate: 5 quick-layout icons **within UltraCar card** between START and existing 3 bottom actions, equal side gutters, no black bar/popup, no adjacent pane overlap; 6 saved-card handles, drag/save after restart, Camera intact.

## Regression safety gates
`node --test tests/ultracar-v57-release-safety.test.mjs`

Pure functions test manifest version checks, exact-file signing, the `*signed_TEST.apk`/unsigned-suffix bug, collision refusal, and distinct TEST publication/device acceptance. No keystore, credentials, PC01 mutation, or deployment in this source-only packet.

**Current status:** CI/source readiness is not release readiness. No signed v57 or v57 cloud file; current PC01 metadata reports code297/name v56. Native Compose subtree integration remains a separate unresolved UI requirement; visually bounded overlay is not proof of native hierarchy. Production unchanged.
