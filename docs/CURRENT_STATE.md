# Current State

Date: 2026-09-05
Status: repo-side mirror only. Trạng thái thực thi hiện hành luôn ưu tiên Nguồn Sự Thật động và bằng chứng exact mới hơn file này.

TigerIQ AI Lab vận hành theo mô hình công ty AI phân tán liên tục. Tiger IQ Driver (`newsdayads/drivetrack`) tách biệt và không thay đổi.

## Thứ tự Nguồn Sự Thật
1. Chỉ đạo hiện hành của anh Sơn.
2. Dynamic Command + AI Employee Registry #335.
3. CENTRAL authoritative queue/router #280.
4. Exact current target / ownership / evidence issue hoặc PR.
5. File này chỉ là mirror repo-side.

Nếu file này mâu thuẫn nguồn mới hơn, phải fail-closed theo nguồn mới hơn; không suy diễn trạng thái máy thật từ repo mirror stale.

## Danh mục lệnh / nhân sự hiện hành
- `1` -> **Minh (NV01 — Thực thi trực tiếp)** / `OWNER_FOREGROUND` / enabled.
- `2` -> **Khoa (NV02 — Vận hành tự động)** / `AUTONOMOUS_P0_FIRST` / enabled.
- `3` -> **Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)** / `LOCAL_SYSTEM_FIRST` / enabled giới hạn.
- Unknown/disabled -> `COMMAND_UNREGISTERED`.

Bootstrap 2.2 dynamic resolver đã áp dụng. NEW CHAT `1`/`2` đã có regression ĐẠT; command `3` đã được re-enable giới hạn và có PC01/Ollama canary + genuine NEW CHAT acceptance theo #335/#355/#356.

## P0 ownership hiện hành
### #338 — Minh/NV01
- Scope: PC01 Server / TigerIQ Control Plane / AI PC01 Web Control.
- `OWNER_HOLD=true`.
- Khoa/NV02 và Huy/NV03 phải SKIP resource này.

### #306 — Khoa/NV02 / Auto Worker
Current corrective candidate: **V13.4.4 — Exact 504×834 / Top5 / Right5 / DPI-safe screen hint**.

V13.4.4 contract/evidence:
- Tiger control lấy `screen.availLeft/Top/Width/Height`, truyền `screenHint` sang background.
- Mỗi explicit START normalize + verify exact **504×834, Top 5, Right 5**.
- `windows.update` + `windows.get` verify tối đa 3 lần, tolerance 8 px; fail => **BỊ CHẶN**, không dispatch `2`.
- Installer không tự mở Chrome.
- Exact Project: `https://chatgpt.com/g/g-p-6a925c470aa08191a10595e215d04f4e-tigeriq-ai-lab/project`.
- Readiness trước `2`: đúng Project + document complete + composer enabled + URL stable 5×500ms + grace 1500ms; timeout 90s.
- Artifact `TigerIQ_AW_13.4.4.cmd`, SHA-256 `e9959c1fdc2202eed90dc292bbe7baf917f333e4b8d898a92ac0b542c8eea180`.
- Source/tests ZIP SHA-256 `77585fb81511b1130286eeb8bdf9f0b05a9a849930e02d852956c8c4750c16f8`.
- Static/mock/regression **22/22 ĐẠT**.

### Physical placement evidence mới
Owner-confirmed comment `#306 issuecomment-5548193153` xác nhận riêng hạng mục **WINDOW_PLACEMENT = PHYSICAL_PASS / LOCKED**:
- size **504 × 834**;
- **Top 5**;
- **Right 5**;
- explicit START phải giữ placement trước dispatch;
- candidate sau phải retest baseline này.

Không suy diễn toàn #306 đã ĐẠT. Project/readiness/icon/status/lifecycle và các acceptance A–N còn lại tiếp tục theo evidence riêng / #343.

### #362 — Khoa/NV02 / Controller health probe
- Controller V1 dùng `/api/v1/status`; generic dùng `/api/workforce/status`; probe cũ hardcode generic gây 404 giả.
- Draft PR #363 exact `d78ac91d48352acba759e02d72b31981bb809ea8`.
- Regression PowerShell **5 case ĐẠT**; CI #1001 **ĐẠT**; Vercel #402 **ĐẠT**.
- Integration proof #369: Queue #441 + CI #1002 + Vercel **ĐẠT**; #369 đóng không merge.
- Independent review finite/read-only **#376** đã xếp P0; chưa có PASS marker thì không suy diễn independent approval/MAIN/live.

### #347 — Khoa/NV02 / Secure Worker timeout self-heal
- Current Draft PR #348 exact `80544151b418346d3df38374534f0466cd39c43d`; CI #988 **ĐẠT**.
- MIN_300 clamp + marker V2; chống false READY và caller-principal mismatch.
- PR #314 cũ đã đóng **SUPERSEDED / không merge**; branch/commit giữ làm provenance/base.
- Independent review finite/read-only **#378** đã xếp sau state review.
- Chưa integration/live runtime.

### #337 — Khoa/NV02 / Queue Hygiene verifier
- Exact `23e95b390be5eb81c990492bf76c2019189bca46`, chỉ sửa `scripts/verify_work_board_ui.mjs`.
- Queue #422 + CI #972 + Vercel #384 **ĐẠT**.
- Independent review finite/read-only **#379** đã xếp; không suy diễn release authorization.

### #318 — PC01 tự vận hành
- `TigerIQ Workforce Controller` = authority chính; `PC01 Secure Worker` = bounded executor; GitHub command mailbox = bridge.
- OpenClaw = **TẠM GÁC**.
- Remote mailbox `Vy -> PC01 -> execute -> evidence`: **ĐẠT 3/3** qua #321/#323/#324.
- Controller có boot authority ở mức config/runtime đã quan sát.
- Worker + Watchdog vẫn logon-only theo fresh #364/#365, nên pre-login recovery chưa runtime-accepted.
- Physical reboot E2E cần explicit Owner authorization.

### #368 — Huy/NV03 / Worker + Watchdog pre-login autostart
- Huy/NV03 active owner scope `pc01-worker-watchdog-prelogin-autostart`; Khoa SKIP mutation.
- Draft PR #370 exact `a971eff16a53a090ed05906c287e23f3738c46a8`.
- Independent review #372 đã được PC01 claim và có heartbeat thật; chưa có terminal result thì không suy diễn PASS.
- Live principal/trigger change và physical reboot E2E vẫn cần gate phù hợp theo #318/#343.

## Continuity / state hygiene — #319
- Continuity A–E có evidence.
- CENTRAL #280 + Registry #335 + exact #306 chọn V13.4.4.
- State hygiene đã đóng không merge các stale/superseded PR #332, #336, #349, #353, #361, #314; provenance giữ nguyên.
- Default-branch `docs/CURRENT_STATE.md` vẫn materially stale cho tới integration hợp lệ; dynamic authority tiếp tục precedence.
- Mirror branch/PR hiện hành #373 phải được retest mỗi khi exact state thay đổi; CI/review của head cũ không tự chuyển sang head mới.

## Review queue PC01
Theo CENTRAL hiện hành:
1. #372 — Huy/#368 — đang xử lý khi còn heartbeat thật.
2. #376 — Khoa/#362 — P0 chờ claim.
3. state mirror review phải bám exact head mới của #373 sau fresh CI.
4. #378 — Khoa/#347.
5. #379 — Khoa/#337.

Independence phải được chứng minh bằng immutable local model identities/digests; nếu không chứng minh được thì fail closed `TIGERIQ_PC01_NEEDS_EXTERNAL_REVIEW`.

## Web / acceptance trackers
- #261/#322 repo-prep/verifier đã có evidence; physical Web E2E vẫn gate riêng.
- Không dùng legacy `quickWork`/old Work Board assertions làm current contract.

## Hàng đợi cần anh Sơn — #343
1. #306: placement 504×834 / Top5 / Right5 đã **ĐẠT vật lý / LOCKED**; chỉ còn các physical acceptance khác như Project/readiness/icon/status/lifecycle/A–N theo evidence riêng.
2. #318/#368 live principal/trigger change và physical reboot E2E chỉ khi có explicit authorization phù hợp.
3. #261/#322 physical Web E2E khi dependencies sẵn sàng.
4. Android/device chỉ sau fresh installed package/version/signer + current candidate + Controller contract audit.
5. MAIN/Production/security/paid chỉ khi có authorization riêng.

## Historical / deferred boundaries
Không chọn historical tracker làm current job chỉ vì title còn P0 hoặc marker cũ. OpenClaw tiếp tục TẠM GÁC. #341 Gemini Web Multi-AI Worker vẫn deferred cho tới Auto Worker acceptance phù hợp hoặc Owner explicit re-activate.

## Safety boundary
Không autonomous MAIN/Production/release, paid/payment, credential/security/firewall widening, destructive/irreversible action, physical reboot/device mutation hoặc secret exposure.

Khi một scope bị chặn bởi physical/security/MAIN/external gate, command `2` tiếp tục:
`SKIP -> SCAN_NEXT_SAFE -> READ_ONLY_VERIFY -> STATE_HYGIENE -> REVIEW_PREP -> REGRESSION/BACKLOG`.

Không claim **ĐẠT/HOÀN TẤT** nếu chưa có bằng chứng phù hợp.
