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
- Khoa/NV02 và Huy/NV03 phải SKIP resource này; không tạo mutation owner thứ hai.

### #306 — Khoa/NV02 / Auto Worker
Current corrective candidate: **V13.4.4 — Exact 504×834 / Top5 / Right5 / DPI-safe screen hint**.

Nguyên nhân supersede V13.4.3:
- physical evidence xác nhận size nhỏ nhưng window có thể lệch/mất một phần màn hình;
- `system.display.workArea` và `chrome.windows` có thể không cùng coordinate space trên Windows DPI/scaling.

V13.4.4 contract/evidence:
- Tiger control lấy `screen.availLeft/Top/Width/Height`, truyền `screenHint` sang background.
- Mỗi explicit START normalize + verify exact **504×834, Top 5, Right 5**.
- `windows.update` + `windows.get` verify tối đa 3 lần, tolerance 8 px; fail => **BỊ CHẶN**, không dispatch `2`.
- Sau START, user move/resize được giữ; recovery dùng prior normal bounds.
- Installer không tự mở Chrome.
- Exact Project: `https://chatgpt.com/g/g-p-6a925c470aa08191a10595e215d04f4e-tigeriq-ai-lab/project`.
- Readiness trước `2`: đúng Project + document complete + composer enabled + URL stable 5×500ms + grace 1500ms; timeout 90s.
- Artifact `TigerIQ_AW_13.4.4.cmd`, SHA-256 `e9959c1fdc2202eed90dc292bbe7baf917f333e4b8d898a92ac0b542c8eea180`.
- Static/mock/regression **22/22 ĐẠT**; exact layout/background smoke/node syntax/mock update ĐẠT.

Physical Chrome A–N + exact placement/Project/readiness/icon/status vẫn **CHỜ** tại #343. Không tạo version mới nếu chưa có physical/runtime finding hoặc contract change mới.

### #362 — Khoa/NV02 / Controller health probe
Nguyên nhân gốc đã xác minh:
- Controller V1 dùng `/api/v1/status`.
- Generic Controller dùng `/api/workforce/status`.
- probe cũ hardcode generic nên có thể báo HTTP 404 giả.

Candidate Draft PR #363 exact `d78ac91d48352acba759e02d72b31981bb809ea8`:
- auto-detect V1/generic;
- xuất `controller_contract`, `health_path`, `health_ok`, `health_error` và giữ legacy `http`;
- đã sửa false-classification khi một path 404 nhưng contract thực tế tồn tại và unhealthy;
- regression PowerShell **5 case ĐẠT**;
- CI #1001 **ĐẠT**;
- Vercel Verify #402 **ĐẠT**.

Integration proof #369 exact `cd2636de836804b3b1b3be1c1826d3b581658214` stack #363 + current verifier #337:
- Queue Hygiene #441 **ĐẠT**, gồm `Verify Work Board UI`;
- CI #1002 **ĐẠT**;
- Vercel Online Verify **ĐẠT**;
- #369 đã đóng không merge.

Kết luận: Queue đỏ cũ trên #363 là stale verifier baseline, không phải health-probe regression. #362 đang `REPO_READY_FOR_INDEPENDENT_REVIEW`; #363 vẫn Draft/off-MAIN, chưa independent approval, chưa MAIN/live.

### #318 — PC01 tự vận hành
Architecture hiện hành:
- `TigerIQ Workforce Controller` = authority chính.
- `PC01 Secure Worker` = bounded executor.
- GitHub command mailbox = bridge từ Vy/ChatGPT đến PC01.
- OpenClaw = **TẠM GÁC**, không phải P0 hiện hành.

Bằng chứng đã có:
- remote mailbox `Vy -> PC01 -> execute -> evidence`: **ĐẠT 3/3** qua #321/#323/#324;
- Workforce Controller chạy SYSTEM + AtStartup, có boot authority ở mức config/runtime đã quan sát;
- Worker + Watchdog vẫn logon-only theo fresh #364/#365, nên pre-login recovery **CHƯA ĐẠT/CHƯA XÁC MINH**;
- #347/#348 repo-only timeout/self-heal correction có CI ĐẠT nhưng chưa integration/live.

### #368 — Huy/NV03 / Worker + Watchdog pre-login autostart
- Anh Sơn có Owner priority override cho Huy/NV03.
- Active owner scope: `pc01-worker-watchdog-prelogin-autostart`.
- Khoa/NV02 phải SKIP mutation trên resource này.
- Fresh evidence #364/#365: Worker và Watchdog đều `Interactive only`; Worker AtLogon, Watchdog chạy user session dù lặp 1 phút.
- Draft PR #370 exact `a971eff16a53a090ed05906c287e23f3738c46a8` đang mở/off-MAIN, scope repo-only hardening SYSTEM + AtStartup + backup/rollback/idempotency; chưa tự áp dụng live.
- Live principal/trigger change và physical reboot E2E vẫn cần gate phù hợp theo #318/#343.

## Continuity / state hygiene — #319
- Continuity A–E có evidence.
- CENTRAL #280 + Registry #335 + exact #306 hiện chọn **V13.4.4**.
- PR #332 = historical V13.3.5 mirror.
- PR #351/#352 = V13.3.6-era mirror/evidence, superseded.
- PR #353/#354 = V13.4.0-era mirror/evidence, chỉ còn provenance.
- Default-branch `docs/CURRENT_STATE.md` vẫn materially stale cho tới integration hợp lệ; dynamic authority tiếp tục precedence.

## Web / acceptance trackers
- #261/#322 repo-prep/verifier đã có evidence; physical Web E2E vẫn gate riêng.
- #337 exact `23e95b390be5eb81c990492bf76c2019189bca46` là current Command Center Queue Hygiene verifier replacement với Queue/CI/Vercel evidence ĐẠT.
- Không dùng legacy `quickWork`/old Work Board assertions làm current contract.

## Hàng đợi cần anh Sơn — #343
Các gate cần thao tác/authorization thật được gom và đẩy ra sau để không chặn lane tự động:
1. #306 physical Chrome **V13.4.4** update/reload + A–N + exact 504×834 / Top5 / Right5 + Project/readiness/icon/status.
2. #318/#368 live principal/trigger change và physical reboot E2E chỉ khi có explicit authorization phù hợp.
3. #261/#322 physical Web E2E khi dependencies sẵn sàng.
4. Android/device chỉ sau fresh installed package/version/signer + current candidate + Controller contract audit.
5. MAIN/Production/security/paid chỉ khi có authorization riêng.

## Historical / deferred boundaries
Không chọn historical tracker làm current job chỉ vì title còn P0 hoặc marker cũ:
- #156/#161: historical PC01 bootstrap/review provenance.
- #160: deferred Android preflight reference.
- #165/#167: historical Auto-Resume governance provenance.
- #176: historical release-train planning reference.
- #196/#282: historical PC01 recovery/foundation evidence; current PC01 authority là #318/#280.
- #341 Gemini Web Multi-AI Worker vẫn deferred cho tới Auto Worker physical acceptance hoặc Owner explicit re-activate.

## Safety boundary
Không autonomous MAIN/Production/release, paid/payment, credential/security/firewall widening, destructive/irreversible action, physical reboot/device mutation hoặc secret exposure.

Khi một scope bị chặn bởi physical/security/MAIN/external gate, command `2` tiếp tục:
`SKIP -> SCAN_NEXT_SAFE -> READ_ONLY_VERIFY -> STATE_HYGIENE -> REVIEW_PREP -> REGRESSION/BACKLOG`.

Không claim **ĐẠT/HOÀN TẤT** nếu chưa có bằng chứng phù hợp.
