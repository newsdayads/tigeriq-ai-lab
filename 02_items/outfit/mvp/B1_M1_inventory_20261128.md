# GH-5802 B1 — M1 asset inventory & evidence gate

- Work Order: [#5802](https://github.com/newsdayads/tigeriq-ai-lab/issues/5802)
- Parent: [#5779 — DeX Shot MVP V4](https://github.com/newsdayads/tigeriq-ai-lab/issues/5779)
- Prepared by: NV03
- Date: 2026-11-28
- Base: `main@6e925b8ea2c2f4c992d73619de351a05a6c0474f`
- Branch: `nv03/gh5802-b1-m1-inventory-20261128`
- Scope: `02_items/headgear/` and `02_items/outfit/mvp/` staging only
- Decision: `RDC_DECISION=NO_RDC` — GitHub evidence inventory only; no PC01, no Drive connector bypass, no master/GOLDEN/Production writes.

## Result

| Gate | Result | Meaning |
|---|---|---|
| M1 metadata inventory | COMPLETE | GitHub receipts and recorded file/package hashes reconciled below |
| Original 7-item source QA | 7/7 PASS (historical receipt) | Detached PNG source items passed their own alpha/logo QA; this is not outfit-to-pose acceptance |
| B1 pilot fit | NOT ACCEPTED | Existing receipts record shoulder/sleeve, wrist, hip/waist, ankle/heel and strap-wrap defects |
| B1 rear fit | NOT ACCEPTED | Rear candidate exists for one direction only; material/perspective and shoulder/heel/strap wrapping remain open |
| B1 eight-yaw / two-pose fit | NOT ACCEPTED | No evidence of complete accepted fit |
| Master/release | 0 accepted | No candidate in the reviewed receipts is authorized as a master/release asset |

## 1. Original detached source items

Receipt: [#5802 comment 7212212164](https://github.com/newsdayads/tigeriq-ai-lab/issues/5802#issuecomment-7212212164)

| File | SHA-256 | Receipt status |
|---|---|---|
| `item.cap.v001.png` | `0d31d8b0a7b469b52915e23cccc70f5ad9cf436394f2d935820f2a97d17e00d5` | PASS — detached PNG, clean alpha, logo readable |
| `item.headphone.v001.png` | `daebf3da0219ce65d9941d8dd8dc61ddee94f8fe65453aeb79cd6d392200714f` | PASS — detached PNG, clean alpha, logo readable |
| `item.backpack.v001.png` | `140f894df6873f39333183a1dfd71226da6f01b0b49a201938596d7b421359fa` | PASS — detached PNG, clean alpha, logo readable |
| `item.belt.v001.png` | `2fed2d60de59043364aa0253ffc9c9ebdacd6052a91b803993f0d5de4f621041` | PASS — detached PNG, clean alpha, logo readable |
| `item.bottom.v001.png` | `c7d39aafe818edfe869355d9a430d66d2cd8465cd10add8dc8bcf70b90c5e051` | PASS — detached PNG, clean alpha, logo readable |
| `item.shoes.v001.png` | `38c8bf92cc60edba3fc19469e6f90a739560431f3531355e2e939fc50657613f` | PASS — detached PNG, clean alpha, logo readable |
| `item.top.v001.png` | `31dcabe2d124b68633aa3ab013f24c74dfd333ad64d38e45f2087d103a52f4e1` | PASS — detached PNG, clean alpha, logo readable |

**Use decision:** retain these seven as immutable source candidates. Their individual QA receipt does not prove fit on the 16 MVP cues or the 8 viewing directions.

## 2. Subsequent B1 candidate packages

| Package | SHA-256 | Evidence / classification |
|---|---|---|
| V001 visible-layer pilot | `781e5384ea65c475fefcba8d6661d40cd2aac4f0070ff44ecd01800106489c85` | 53 files (52 PNG + receipt); some visible garment groups only at yaw000/yaw045; shoulder/sleeve fit failed; not accepted |
| V002 rear-direction candidate | `72a380bbd09fb8fb47b83eaed67bf3821f49fec8edb235656b864793e04cd8ac` | 15 PNG; rear artwork candidate at yaw180; gradient/material and shoulder/heel/strap wrap not accepted |
| V003 material diagnostic | `fb4e00e7b7a893889cb7e887e41f9dc47486550cee8fffa02283bec767d013a4` | Explicitly REJECTED; do not propagate or use as replacement |
| V004 lower-body fit diagnostic | `2d08ee89196eb60d454cf75371d5fa8a9fbf00badf2eb795f052dac8fc857e70` | Explicit VISUAL_FAIL; exposed foot edges, collar/ankle and waist/hip seam issues; diagnostic only |
| V005 consolidated candidate | `11e1828f4a3fcc8b172c34023d50a8f4fe2ee1fd78a8e43e415f7b2b38b23dd5` | 8,877,386-byte ZIP; 93 PNG files / 92 distinct PNG hashes; includes retained candidates and diagnostics; no new accepted master |

Detailed source receipts:
- [V001 / B1 pilot](https://github.com/newsdayads/tigeriq-ai-lab/issues/5802#issuecomment-7215809566)
- [F2 handoff identifying B1 fit defects](https://github.com/newsdayads/tigeriq-ai-lab/issues/5802#issuecomment-7216016390)
- [V002 rear candidate](https://github.com/newsdayads/tigeriq-ai-lab/issues/5802#issuecomment-7216288558)
- [V003 rejected diagnostic](https://github.com/newsdayads/tigeriq-ai-lab/issues/5802#issuecomment-7216871386)
- [V004 lower-body diagnostic](https://github.com/newsdayads/tigeriq-ai-lab/issues/5802#issuecomment-7218017388)
- [V005 consolidated candidate](https://github.com/newsdayads/tigeriq-ai-lab/issues/5802#issuecomment-7218240857)

## 3. Inventory disposition

| Group | Keep / reject decision | Reason |
|---|---|---|
| Seven original detached items | KEEP as immutable source candidates | Their individual PNG QA passed; do not overwrite |
| V001 visible layers | HOLD as diagnostic/candidate only | Incomplete garment surfaces and visible shoulder/elbow/sleeve discontinuities |
| V002 yaw180 rear layers | HOLD as directional candidate only | Single rear direction; no accepted 135/225 fit or full material/strap wrap |
| V003 | REJECT | Receipt explicitly marks visual failure and prohibits propagation |
| V004 | DIAGNOSTIC ONLY | Receipt explicitly marks visual failure; no master acceptance |
| V005 | HOLD as consolidated evidence package | Contains candidate/diagnostic files, not a release-approved outfit |

## 4. Remaining acceptance work

1. Inspect the actual source ZIP and `00_reference/STYLE_LOCK.json` plus the approved HQ/body anchors at application display size. The current NV03 session does not have the Drive ZIP bytes or the reference binaries attached; metadata receipts alone cannot support visual selection.
2. Reconcile the seven original items and each candidate by exact file SHA; preserve originals and exclude V003/V004 diagnostics from production reuse.
3. Complete one outfit against actual seated laptop, chair/coffee, phone and camera poses; inspect collar, shoulder/elbow, wrist, trouser/hip, ankle/heel, backpack straps and logo/stripe continuity.
4. Extend only after the pilot passes. Do not claim rear/8-yaw/two-pose fit from a single yaw180 candidate.
5. Hand off visual PASS evidence to #5805/#5806 only after direct pixel review.

## 5. Verification boundary

- This file is a **metadata/evidence inventory**, not an independent visual PASS.
- The 7/7 source-item QA and all package hashes above are transcribed from linked GitHub receipts; this session did not re-download the Drive binaries or recompute those hashes.
- Drive link access was unavailable to this session; no connector restriction was bypassed.
- No art was fabricated to replace missing reference assets. No code, tests, CI, browser/device, master, GOLDEN or Production state was changed.
- Current issue remains `DONE=false`; B1 pilot/rear/fit are not accepted.

**Next actionable input:** attach the exact V005 ZIP (or provide an authorized readable source path) and the STYLE_LOCK/HQ/body reference binaries in this chat. Then perform pixel-level selection and generate only the missing/rejected art, with per-file SHA/CRC and a fresh evidence receipt.
