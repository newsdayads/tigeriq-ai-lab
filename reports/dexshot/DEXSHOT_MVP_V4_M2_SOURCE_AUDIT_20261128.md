# TiG DeX Shot MVP V4 — M2 source-access audit
Date: 2026-11-28
Work order: GH-5779 / card GH-5806
Plan: DEXSHOT_MVP_V4_20261127
Result: BLOCKED_ON_SOURCE_BYTES
DONE=false
MUTATION_SCOPE=REPORT_ONLY_NON_MAIN_BRANCH
MAIN_MUTATED=false
GOLDEN_MUTATED=false
PRODUCTION_OR_OTA=false
FORMAT_TESTS=NOT_REPEATED

## Scope and gate
M2 is independent visual QA of 16 storyboard cues and 5 props at app scale. The 16 cues are presentation only; preserve 13 business states, 10 bubble presets, capture safety, safe/parked movement, and existing GOLDEN. Do not proceed to accepted-only M3/M4 or M5 integration until visual decisions and required approvals are evidenced.

## Exact candidate inputs recorded by the live work order
1. 16-cue candidate ZIP:
   https://drive.google.com/file/d/1XrdX_mdyblq7sTWb-0EeXFVtvxWopJSi/view
   SHA256: d43418aaa8380296f4bc1be4de8b5aa8df21db91be082a96720024fdef019628
   Existing receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/5779#issuecomment-7224862612
   Receipt says 16/16 illustrative candidates, 0 approved exports; pose/outfit variance remains.
2. 5-prop candidate ZIP:
   https://drive.google.com/file/d/1cCjo1d6z--q-ZQblGdKl1KpuhQDL4K_T/view
   SHA256: 148194da07afea772cd90e976d45dd296c92e399ebf5a8a6ddd051ab0fa3f72e
   Existing receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/5779#issuecomment-7224616936
   Receipt says 5 isolated props; character/hand fit and independent F2 acceptance remain unverified.
3. Baseline pack (33 PNG + 10 SVG):
   https://drive.google.com/file/d/1PNfQonsYydxy8kDoLydECLSfJAM1M1Tc/view
   SHA256: 529927550d6c24692e494fd8873a68c9bd8174465deddce7a21dd23a1c1d7c8e
4. F2 preview delta (not full pack):
   https://drive.google.com/file/d/1YkYncg9O_PhErdACTEC-dOkzN9GsyVwj/view
   SHA256: 59af68b403ed1aa75a3d4fd9da761baf6acf1dbc9136ad101b182067ce116577
5. Consolidated 21-item review archive referenced by prior review:
   SHA256: 7c3e618c3443c9b046ccafb47d76a9bccf84f50d80fb90ad92db7823c9d7a54e
   Earlier receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/5779#issuecomment-7230788545
6. Style contract / reuse-map evidence:
   https://github.com/newsdayads/tigeriq-ai-lab/issues/5779#issuecomment-7223459040
   https://github.com/newsdayads/tigeriq-ai-lab/issues/5779#issuecomment-7224520946
7. Latest M2 checkpoint:
   https://github.com/newsdayads/tigeriq-ai-lab/issues/5806#issuecomment-7236854860
   It records the exact 16-cue and 5-prop ZIPs above, 21 visual decisions still pending, and source bytes / STYLE_LOCK / identity anchor unavailable in that session.

## Later candidate outputs — not M2 acceptance
- 5 motion clips v002 ZIP: https://drive.google.com/file/d/16GXdxyvqGyNjVaRHkrc-cno1LsCFXxoU/view
  SHA256: aa284225be1fbef642cb2ba7fb6aa587f6e74d213ae427c9fe9fcff8c715d109
  Existing handoff: https://github.com/newsdayads/tigeriq-ai-lab/issues/5806#issuecomment-7234856032
  The handoff marks it CANDIDATE_NOT_RELEASE and states steering/wheel/continuity/runtime require independent QA.
- APK DeX Shot v1.4.36 (code 44): https://drive.google.com/file/d/1xlmZY2vPUp2XK0lzBOXOD-Lizc0EM6Vz/view
  Existing receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/5806#issuecomment-7234929997
  The receipt reports a 27.07 MB APK and successful install on SM-N950U. This does not prove the 21 M2 decisions, exact V4 source branch, CI on an exact PR head, or Z Fold 2 DeX acceptance.

## Execution evidence in this session
- Re-read the attached Loader v1.2 and canonical GitHub work-order state / latest M2 checkpoint.
- Checked the exact Drive share URLs via the available web fetch; both candidate ZIP URLs returned inaccessible. The available session has no mounted candidate ZIP, source images, STYLE_LOCK.json, or TiG identity anchor.
- No raw image pixels were available; therefore no honest app-scale visual inspection or 21 accept/reject decisions could be performed.
- No redundant hash/CRC/format tests were repeated.
- No art was generated blindly; no source app code, TEST branch, MAIN, GOLDEN, Production, or OTA was changed.
- No placeholder PR, unrelated merge, or false CI/device PASS was created.

## Gate status
| Gate | Evidence status |
|---|---|
| M2 — 16 cues + 5 props visual QA | BLOCKED_ON_SOURCE_BYTES; 21 decisions pending |
| M3 — accepted-only motion | NOT_ACCEPTED |
| M4 — Studio MVP / export package | NOT_ACCEPTED for this current M2 gate |
| M5 — Owner preview + verified TEST branch/contract/writer + integration | NOT_ESTABLISHED |
| M6 — exact-head CI + Z Fold 2 DeX/phone acceptance | NOT_VERIFIED |

## Required unblock
Provide the exact current 16-cue and 5-prop candidate ZIPs (or all 21 raw source images), plus `00_reference/STYLE_LOCK.json` and the TiG identity anchor, as conversation attachments or restore the authorized Drive connector. Then:
1. Inspect each cue/prop at app scale against STYLE_LOCK and identity anchor.
2. Record 21 individual accept/reject decisions with image-level evidence.
3. Repair only confirmed defects; retain accepted assets unchanged.
4. Continue accepted-only M3/M4, produce an Owner preview, then verify TEST branch/contract/writer before any scoped code integration.
5. Run all required automated checks against the exact PR HEAD; merge only after all required checks and acceptance gates pass. No Production/OTA implied.

This report is an auditable blocker/evidence artifact, not a claim that M2 or the MVP is complete.
