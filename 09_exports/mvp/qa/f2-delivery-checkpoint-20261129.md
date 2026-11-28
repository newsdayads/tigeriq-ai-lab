# GH-5806 CARD-F2 — Delivery & Acceptance Checkpoint
Date: 2026-11-29
Repository: newsdayads/tigeriq-ai-lab
Base ref: main
Base commit observed before branch creation: c379ad9711ded2f283c95f8f099ba7d09f163454
Work order: GH-5806 / parent #5779
Role: CARD-F2 independent QA and lightweight Studio integration
Plan: DEXSHOT_MVP_V5_ART_FIRST_20261128

## Executive result
STATUS=INCOMPLETE_NOT_RELEASE
DONE=false
M2_VISUAL_ACCEPTANCE=NOT_ACCEPTED
M3_MOTION=PARTIAL_CANDIDATES_ONLY
M4_STUDIO=OFFLINE_PREVIEW_ONLY
M5_OWNER_PREVIEW_AND_WRITER_GATE=NOT_PASSED
M6_DEVICE_RUNTIME=NOT_VERIFIED
NEW_ACCEPTED_ART_THIS_CHECKPOINT=0
APK_OR_MAIN_OR_GOLDEN_OR_PRODUCTION_MUTATION=NONE

This file is a verifiable checkpoint/evidence index, not a claim that the DeX Shot MVP is complete or released.

## Verified GitHub source state
- Issue #5806 remains OPEN. Its live body says Studio v010 is an offline 537-file preview and explicitly leaves M1/M4/M5/M6 acceptance open.
- Parent #5779 remains OPEN under V5 ART_FIRST.
- CARD-CD #5805 remains OPEN. The latest recorded CARD-CD activity is a CODEOBJ reactivation event, not an accepted Received/Reconcile art handoff.
- CARD-A #5801 and CARD-B2 #5803 remain OPEN.
- Owner policy #504 prohibits GitHub Actions. Verification must use the approved local route; no Actions run was started.
- Latest main commit observed before branch creation: c379ad9711ded2f283c95f8f099ba7d09f163454.

## Existing candidate artifacts — retain, do not retest same SHA
| Artifact | Recorded evidence | Classification |
|---|---|---|
| Motion V002 source | SHA256 aa284225be1fbef642cb2ba7fb6aa587f6e74d213ae427c9fe9fcff8c715d109 | Source/reuse baseline |
| Capture V004 optimized package | SHA256 9e247fb92e21810c3dfa8c85ca4c555e551a841656ea2f616288bf01aca6e2ff | Technical candidate; not independent acceptance |
| Compact V002 Q98 package | SHA256 4c11b9de138b2cbf1685b26d06923a69d6b82e180dd5db09f46fc3bffd6b496a | Technical candidate; not release |
| F2 Studio V010 delta | SHA256 59af68b403ed1aa75a3d4fd9da761baf6acf1dbc9136ad101b182067ce116577 | Delta only, not full pack |
| Reference bundle HQ + laptop + STYLE_LOCK | SHA256 2cb855d9baa6dd90a6cf971a908537e9b1c84b2f6b85d01d50cf6e3d699e7efa | Reference-only package |
| Reference board PNG | SHA256 1ab76c80b5f8dd9aa702d772531c7c0b4294167c94dd558be4fafcab9cd16ac3 | Reference-only image |

### Technical result retained
Compact V002 Q98: 3 clips (greet_wave, coffee_seated, laptop_work), 48 reused distinct frames, alpha 48/48, timing 16 × 60ms per clip, loop preserved, minimum recorded PSNR 39.9749 dB at 168/256px light/dark, total clip bytes reduced 11.57%. This is TECHNICAL_CANDIDATE_NOT_RELEASE and must not be counted as new art or independent visual acceptance.
Evidence: https://github.com/newsdayads/tigeriq-ai-lab/issues/5806#issuecomment-7243494238

Capture V004 remains preserved and must not be regenerated or same-SHA retested.
Evidence: https://github.com/newsdayads/tigeriq-ai-lab/issues/5806#issuecomment-7242896795

## Rejected art — do not import or regenerate by the same failed method
- Received native 6-frame attempt SHA256 01906ec23245a3659cb809344f13188a21ec737fe736f31bd1f3197e146e50db: genuine nod but identity drift (cap brim, shirt, muzzle, chair); rejected.
- Received correction SHA256 8ef0444a21dc682fb11a07cc97f8625326bd61401862afa9433d9a17278a0ffa: unrelated DSLR-only subject; rejected.
- Reconcile attempt SHA256 bbc79fbe721a8cc83eef7bd1bc91dbc936c1c5c1d6775207bc6d47812c4828a2: action composition relevant but identity/scene drift at 168px; rejected.
- Reconcile second attempt SHA256 8d17604f14da7bcf53b197b337db9130278b0114490e060748b6535d3a1ca0e2: wrong subject; rejected.
- Rejected-only QA package SHA256 b6fd29d02d270f73c86617a9a3ad8384c66dc18216b697de5823810b76c21711. It is evidence only, never an import candidate.
Evidence: https://github.com/newsdayads/tigeriq-ai-lab/issues/5806#issuecomment-7242971144

## Acceptance matrix
| Gate | Result | Evidence/condition |
|---|---|---|
| M1 inventory/reuse map | PARTIAL | Existing reuse map and cue candidates; full independent decisions not recorded |
| M2 visual QA | NOT ACCEPTED | 21-item visual QA not signed off; Received/Reconcile identity mismatch |
| M3 motion | PARTIAL | Capture/compact candidates exist; no accepted complete motion set |
| M4 Studio preview | OFFLINE ONLY | V010 537-file offline preview; no browser/device runtime acceptance |
| M5 Owner preview + branch/contract/writer | NOT PASSED | Owner preview and verified writer/contract gate outstanding |
| M6 exact-head + DeX/phone | NOT VERIFIED | No real DeX/phone acceptance receipt for this checkpoint |

## Next allowed action
1. CARD-CD independent art author must use the locked HQ identity anchor, laptop V002 reference, and STYLE_LOCK; first create one Received pose and inspect at 168px on light/dark backgrounds before any frame sequence.
2. Only after Received passes identity review, create Reconcile against the same locked scene.
3. F2 then performs independent visual QA on the new bytes, records per-cue PASS/FAIL, hashes, CRC, and readback evidence.
4. Preserve all existing Capture V004 and Compact V002 candidates. No same-SHA retest.
5. Keep M5/M6 closed until their named acceptance evidence exists.

## Scope and safety
- This checkpoint creates no art, code, APK, branch integration, or release.
- No changes to main, GOLDEN, Production, OTA, or app runtime.
- No GitHub Actions.
- No device mutation; RDC_DECISION=NO_RDC.
- This report does not claim a mutation lease or an active background worker.

## Canonical links
- Work order: https://github.com/newsdayads/tigeriq-ai-lab/issues/5806
- Parent plan: https://github.com/newsdayads/tigeriq-ai-lab/issues/5779
- CARD-CD authoring lane: https://github.com/newsdayads/tigeriq-ai-lab/issues/5805
- CARD-A: https://github.com/newsdayads/tigeriq-ai-lab/issues/5801
- CARD-B2: https://github.com/newsdayads/tigeriq-ai-lab/issues/5803
- Owner policy / no GitHub Actions: https://github.com/newsdayads/tigeriq-ai-lab/issues/504

