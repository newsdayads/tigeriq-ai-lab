# TIGERIQ — KẾ HOẠCH TÍCH HỢP CÓ KIỂM CHỨNG PHƯƠNG PHÁP PSTACK
Version: 1.0 | 2026-10-18 ICT
Status: PLAN_RECORDED, NO_LIVE_EXECUTION, NOT_ACCEPTED
Authority: GitHub main, Loader, Constitution/Workflow/AI Employee/Baseline/Source Index; Issue #504, #280; PR #5003
Project: tigeriq-platform | Workstream: pstack-portable-verification | Priority: P1
Owner goal: tận dụng năng lực pstack đã được chứng minh trong tài liệu nguồn để **TigerIQ tự kiểm chứng kết quả người dùng**, không phụ thuộc Cursor lúc vận hành.

## 0. Quyết định và nguyên tắc
- Giữ MỘT điều phối/hàng đợi TigerIQ, một Skill Registry và công cụ Playwright/Chrome DevTools đang có; **không** cài toàn bộ plugin Cursor vào Core, không xây planner, scheduler, memory, provider pool thứ hai.
- Xem pstack là **nguồn tham khảo có mã**, không là AI hoặc dịch vụ tự chạy. Chỉ chuyển những hợp đồng có thể chạy độc lập: Launch → Doctor → Drive → Evidence → Cleanup; Feature Map; quy trình duy trì và Prove It Works.
- Không coi thành công của CI unit test là thành công sản phẩm. Pilot phải có ít nhất một lần dùng sản phẩm trong **sandbox cô lập thực sự** trước khi được xem xét là có chức năng.
- Phân biệt các cổng riêng: ghi GitHub nhánh/PR; thay đổi mã Core/Coding Lane; thực thi/sandbox; PC01 host/install; Production; App Chrome LOCAL-only. GitHub write không tạo Core lease. Quyền P0/miễn review/phát hành dùng đúng chính sách hiện hành, không giả approval/lease.
- Reuse PR #5003 - pstack sandbox verification; PR #5001 - Core completedStepId là việc KHÁC, không đưa vào đường găng sandbox pilot. Issue #2054 - Paperclip R01 KHÁC, không nhập chung. Issue #280 cấm tạo Issue mới; các Task dưới đây là checklist trong hồ sơ PR hiện hữu và tài liệu này. Nếu #280 thay đổi, đối chiếu trước khi mở nhiệm vụ mới.
- Cổng mặc định: NO_PAID_COST, NO_CREDENTIAL_CHANGE, NO_SECURITY_BOUNDARY_CHANGE, NO_DESTRUCTIVE, NO_UNAUTHORIZED_PC01, NO_PRODUCTION, NO_APP_CHROME_MUTATION, NO_DIRECT_MAIN.

## 1. Nguồn tham chiếu / xuất xứ
**Upstream chính thức:** https://github.com/cursor/plugins/tree/main/pstack
- Plugin manifest v0.15.26 blob dd850eafb69ea165a1e1caf70dd8372d88b6d625.
- MIT license blob 6b5400237fdf6545be0b8fae370d6f2fcff8fb25; khi **sao chép mã/Skill đáng kể** phải giữ thông báo bản quyền và license.
- create-verification-skill/SKILL.md blob 140d033a001e8d27acd14b06004506c43053b199; maintain-verification-skill/SKILL.md blob a2680b91fead45a0b4963d8c367a854956bea59d; principle-prove-it-works/SKILL.md blob 5dc14a3b06f9d579e5c17cd8a7242f432ddb3125.
- Không chạy upstream installer/agent/model/prompt một cách trực tiếp khi chưa audit dependency, network, file mutations, scope và license qua external-skill-security-gate ACTIVE.

**TigerIQ đã có:** docs/skills/registry.yaml ACTIVE-only loader; apps/tigeriq-coding-lane/step-contract.mjs; apps/tigeriq-coding-lane/product-acceptance.mjs; Playwright e2e; docs/skills/visual-quality-gate/SKILL.md ACTIVE; skill intake security gate ACTIVE; Issue #4902 G1-G6 source-work đã nghiệm thu riêng, KHÔNG phải live pilot nghiệm thu. Không nhân bản các thành phần đó.

**Baseline PR #5003:** 5 file gồm harness read-only scripts/verify-core-ui-sandbox.mjs, unit tests, Candidate SKILL + 1 feature map, package.json test. PR draft OPEN; commit 6457f31874d78469a8e32ba2bacc7c2c2a8ce9a2: CI 39118327696, Queue 39118327757, Vercel 39118327706 SUCCESS; Chrome Controller Package SKIPPED (không tính PASS). Đó là **baseline trước khi thêm tài liệu này**; phải kiểm lại CI ở HEAD mới. Sandbox LIVE receipt, PC01 installed SHA, Skill Registry ACTIVE: CHƯA CÓ.

## 2. Mục tiêu nghiệm thu cuối cùng
AC-01: Có một đường chạy kiểm chứng **một tính năng** TigerIQ trên instance test cô lập, không fake API; đầu vào Issue thật của sandbox; Doctor xác nhận process/build/đầu vào mới/đúng instance.
AC-02: Agent/harness đi theo đúng giao diện người dùng (mở work card → chi tiết), ghi nhận trước/sau + API readback + ảnh + log/trace + thời điểm + mã build, giữ chứng cứ sau cleanup.
AC-03: Khi thiếu sandbox, sai/già dữ liệu, không mở được giao diện, không khớp GitHub Issue, cổng ngoài phạm vi: báo BLOCKED/INCONCLUSIVE, không PASS/đánh dấu checklist giả.
AC-04: Phải tự đóng tài nguyên đã tạo, không đụng profile/phiên App Chrome/NV02/NV03/NV04; không thay production DB, quyền, cred, chi phí.
AC-05: Chỉ sau real sandbox canary và security review mới xem xét Registry VALIDATED/ACTIVE theo quy trình #859; có đọc lại Registry và prompt thực tế chứng minh nạp được Skill phù hợp, không chỉ ghi YAML.
AC-06: Khi tích hợp executor hợp lệ, một Work Order nhận đúng skill ACTIVE, đúng task packet, quyền và receipt; tiêu chuẩn hoàn tất gồm artifact đúng SHA + live evidence, không để CI xanh thay thế.
AC-07: Giám sát pilot bằng so sánh công việc CÙNG LOẠI; tối thiểu 20 trường hợp có thể so sánh trước khi tuyên bố cải thiện định lượng. Không bịa năng suất hay tự động chạy nền.
AC-08: Có rollback và kết quả dừng canary; không làm suy giảm chức năng đang vận hành.

## 3. Phân kỳ thực hiện và Work Breakdown Structure (không tự động dispatch)
Các Task trong bảng thuộc MỘT kế hoạch/PR, không phải GitHub Issues mới. Ký hiệu: S=source-only, L=live sandbox (đòi bề mặt/permission thật), R=release có cổng riêng.

| ID | P | Nội dung và người chịu trách nhiệm | Phụ thuộc | Đầu ra xác định | Gate nghiệm thu |
|---|---|---|---|---|---|
| T00 | P0 | Vy: nạp 5 Bootstrap + Loader + #504/#280; chốt phạm vi, kiểm PR/source ownership | không | source/PR SHA + bản đồ trùng lặp + policy snapshot | không sinh issue mới; không lấy snapshot làm live |
| T01 | P0 | Vy + bộ đọc nguồn: audit upstream provenance/LICENSE/installer/mapping quyền READ/WRITE/COMMAND/NETWORK/CONFIG | T00 | security decision & bảng năng lực có/không dùng | không thực thi package ngoài; nguồn pin |
| T02 | P0 | Vy: rà toàn bộ harness PR #5003 về ngoại lệ I/O, SSRF/redirect, symlink evidence dir, port/URL allowlist, Chrome isolation, timeout, HTTP auth/session, cleanup | T01 | báo cáo finding theo độ nghiêm trọng; bản vá riêng nếu chứng minh lỗi | không có đường ra khỏi sandbox hoặc ghi thư mục ngoài |
| T03 | P0 | Coding Lane bounded GitHub branch: sửa lỗi có chứng cứ T02, thêm negative tests | T02 finding | diff tối thiểu & exact-head CI | fail-closed với URL lạ, instance lạ, stale, redirect, symlink, side effects |
| T04 | P0 | Vy / người vận hành được phép: xác định quy trình mở sandbox API Health từ mã nguồn, node/browser/seed/port/profile không dùng host đang chạy | T02 | runbook launch, readiness, teardown và kiểm chứng isolation | sandbox mới có đường chạy được; không suy từ CI |
| T05 | P0 | NV06/authorized test executor hoặc Vy công cụ hợp lệ: chạy Doctor trên sandbox, chọn một Issue test hiện hữu, ghi source/runtime build SHA | T04 | doctor JSON, timestamp, PID/port/profile, work JSON | instance đúng & dữ liệu mới; có job/permission riêng khi cần |
| T06 | P0 | Authorized isolated Playwright: drive UI card → modal → đối chiếu API + ảnh/trace/JSON, bắt lỗi khi mismatch | T03,T05 | tập biên nhận real sandbox có nguồn/trước/sau/log/time | 1 user journey đạt; lỗi thật trả FAIL không sửa fixture cho qua |
| T07 | P0 | Verifier độc lập theo cổng áp dụng: kiểm chứng thật receipt, freshness, đúng source SHA, screenshot tồn tại sau cleanup, browser/instance cleanup, negative cases | T06 | verdict pass/fail/inconclusive có dẫn chứng | không tự nhận Live/Production từ sandbox |
| T08 | P1 | Owner/Vy: hợp nhất PR sau branch checks, độc lập review hoặc waiver đúng phạm vi và GitHub protection; đối chiếu main | T07 + GitHub gate | merge_sha + main blob readback + kết quả checks | chỉ source merged, không tự active Skill |
| T09 | P1 | Skill-governance executor: kích hoạt Skill theo #859 trên nhánh/PR riêng hoặc bổ sung phạm vi hiện hành khi đúng quyền; pin provenance/version; test canary loader | T07,T08 | Registry VERIFIED state, prompt/source capture, manifest | CANDIDATE không tự chuyển ACTIVE; runtime có nạp bằng chứng mới đạt |
| T10 | P1 | Core/Coding Lane executor có lease: tích hợp bộ kiểm chứng dạng adapter nhỏ vào task compiler/acceptance path đã có, gọi Skill ACTIVE theo job | T09 | bounded adapter diff, no new queue/scheduler; negative tests | typed output; no mutation outside allowed scope; genuine receipt |
| T11 | P1 | Authorized canary: kiểm tra E2E một job được giao → sửa tính năng có kiểm thử → live sandbox verify → receipt → ghi checklist; kiểm restart/fail-safe | T10 + action permissions | chain IDs, source SHA, runtime receipts, final criterion review | 1 nhiệm vụ thật đạt, no duplicate dispatch; parent not falsely DONE |
| T12 | P1 | Vy: so sánh tối thiểu 20 việc cùng loại trước/sau, tỷ lệ chấp nhận thực, vòng sửa, thời gian nhận chứng cứ đầu tiên, lỗi giả và chi phí | T11 | bảng đo & phương pháp chọn mẫu (không chọn mẫu thiên lệch) | nếu chưa đủ mẫu ghi NOT_MEASURED, không công bố % |
| T13 | P1 | Maintainer/verifier: áp dụng maintain-verification-skill, cập nhật feature map chỉ với khác biệt đã chứng minh; không sửa product code trong cùng maintenance PR | T07, định kỳ khi thay feature | drift report, 1 PR tối đa cho một đợt nếu có thay đổi | live feature-map check; không làm test yếu đi để pass |
| T14 | P1 | Authorized releaser: xem xét rollout lên PC01/Production nếu có nhu cầu thật; kiểm Owner V2 release hiện hành, exact SHA/backup/rollback và giới hạn độc lập | T08-T12 + gate thực | release/rollback receipt hoặc documented no-go | không triển khai mặc định; quyền source ≠ host/runtime |

**Đường găng tối thiểu để chứng minh giá trị:** T00 → T01 → T02 → T04 → T05 → T06 → T07. T03 chỉ thực hiện khi có finding buộc sửa; T08-T14 KHÔNG chặn pilot read-only. PR #5001/Core step-id và Paperclip #2054 không nằm trên đường găng. Sau G0 pilot mới quyết định có cần T09-T14 không.

## 4. Chuỗi trạng thái, stop rule, thời lượng dự toán
1. **Gate A — SOURCE** (T00-T02): nguồn/chính sách/duplicate/security pin đạt. Dự toán công làm việc 0.5–1 ngày; thiếu nguồn: SOURCE_UNAVAILABLE.
2. **Gate B — ISOLATION** (T03 khi cần + T04): sandbox khởi chạy được, không dùng port/profile/DB đang vận hành. Dự toán 0.5–2 ngày tùy môi trường; không có sandbox/chưa cấp quyền host: EXTERNAL_WAIT_SANDBOX.
3. **Gate C — TRUE PROOF** (T05-T07): real UI/API journey, screenshot/trace/JSON, cleanup. Dự toán 0.5–1 ngày khi môi trường đã sẵn; FAIL phải ghi đúng bước, sửa lỗi thật thay vì tăng số PR.
4. **Gate D — SOURCE MERGE + SKILL** (T08-T10): chỉ sau Gate C, CI đúng PR HEAD, protected merge, Registry security/ACTIVE tests, adapter bounded. Dự toán 1–3 ngày, không ép khi pilot chưa chứng minh.
5. **Gate E — OPERATION + MEASURE** (T11-T14): một kết quả runtime, sau đó tập mẫu ≥20 nhiệm vụ cùng loại, release khi thực sự có lợi ích. Thời lượng do số lần thực thi/chi phí/permission thật quyết định, không hẹn ngày DONE.

**Không replay cùng SHA và cùng lỗi quá 2 lần** nếu không có bằng chứng thay đổi. Không thực thi việc ngoài scope vì một worker rảnh. Không tự động chuyển blocker đọc đơn giản thành Core DB lease. Khi một Gate bị chặn: giữ nguyên Gate, làm các bước READ_ONLY độc lập còn đầu vào; kết thúc có lý do và wake condition.

## 5. Phân vai và quyền
- Vy/Owner: kiến trúc, ưu tiên, kiểm trùng, acceptance/decision, source/documentation PR, không giả worker claim.
- GitHub implementation lane (theo giao việc thực): chỉ commit nhánh được phép, exact source/check tests, atomic scope writer khi là Core-dispatched mutation.
- Reviewer/verifier độc lập khi chính sách yêu cầu; OWNER_WAIVED_NOT_INDEPENDENT_PASS chỉ ở đúng grant, không tự coi review APPROVED.
- NV06/PC Operator: chỉ các read-only typed actions đã được phép; **không phải** quyền RDC chung, không tự cài máy; sandbox browser runner phải có độc lập profile.
- Release authority: GitHub protection + Owner Project Autonomy V2 khi trong phạm vi và được xác minh live, không cần xin lại phiếu cũ; App Chrome là LOCAL-only và ngoài phạm vi.
- No paid model required; default zero-cost. Bất kỳ tool gây phí/quyền bí mật/Production/destructive phải được phân loại trước, không tự xử lý.

## 6. Rủi ro trọng điểm, đối sách và bằng chứng
| Nguy cơ | Mức | Phòng ngừa/điều kiện |
|---|---|---|
| Chạy nhầm Core/PC01/Production, port/proxy/shared browser | Nghiêm trọng | loopback + instance/port ownership readback; không 3150/3210; profile mới; fail-closed với unknown port/sandbox |
| Pilot dùng mock rồi báo sản phẩm thật | Cao | T05-T07 cấm page.route trong live run; show before/after + API/server logs + screenshot + source SHA |
| Registry được đánh ACTIVE khi chưa có canary | Cao | gate #859, source pin, test ACTIVE-only, runtime selectedSkillIds readback |
| Không có lệnh launch/seed sandbox hợp lệ | Cao | T04 STOP/BLOCK đúng gate; không dùng host production thay thế |
| Symlink, external network, redirect, filesystem side effects | Cao | T02 security review + negative test; không ghi file ngoài evidence root |
| CI xanh nhưng không giao job thật | Cao | phân biệt source checks, install, resource/lease receipt, actual runtime acceptance |
| Nhân đôi scheduler/skill/issue | Cao | reuse #280, existing Core skill loader, PR #5003, Gate G1-G6; duy nhất một chủ cho mỗi nguồn |
| Plugin/hướng dẫn upstream thay đổi | Trung bình | pin blob + MIT; version diff/review trước update; không tự tải lại mọi phiên |
| Nhiều reviewer/model tốn tiền | Trung bình | phạm vi nhỏ, zero-cost-first, chỉ dùng fan-out khi có giá trị, no paid step mặc định |
| Đo cải thiện thiếu baseline/chọn mẫu lệch | Trung bình | >=20 nhiệm vụ cùng loại và mẫu đối chứng, báo định tính cho tới đủ số liệu |
| PR #5003 và #5001/Issue #2054 xung đột | Trung bình | giữ độc lập: 5001 Core step-id; 2054 Paperclip R01; 5003 sandbox verification; không tự sửa trạng thái nhau |

## 7. Quy tắc nghiệm thu và rollback
- Checklist này là **plan**, mọi Task mặc định UNVERIFIED/PENDING cho đến khi có evidence URL đúng SHA/action. Không tự tích hộp để tạo tiến độ.
- Test mã nguồn: CI exact PR HEAD, các ca phủ negative paths, metadata/capability/source guard. Test sản phẩm: một kết quả qua giao diện/browser thực với API độc lập, checksum/source SHA và ảnh/trace; test device/PC01 là bước **riêng** sau scope grant.
- Gate hoàn tất cuối: tất cả AC-01...AC-08 có dẫn chứng tương ứng, quản trị Skill ACTIVE đúng thẩm quyền, không có blocker, đối chiếu runtime sau deploy nếu có. Nếu chỉ pilot đạt thì báo **PILOT_ACCEPTED** chứ không báo TIGERIQ_FULL_INTEGRATION_DONE.
- Rollback nguồn: revert PR chính xác qua GitHub, không reset main/force push. Rollback canary: dừng chỉ phiên/sandbox do test tạo; không xóa receipts. Rollback Skill: về CANDIDATE/disable theo Registry governance, không xóa dữ liệu công việc. Rollback PC01 nếu có: theo release guard Owner V2 + biên nhận thực, không thao tác host từ chat.
- Báo cáo đo lường: fields gồm baseline/control, samples, success/fail, time_to_evidence, rework_count, costs, regressions; thiếu chứng cứ thì INCONCLUSIVE.

## 8. Ghi nhận hiện tại (chỉ những gì đã kiểm tra)
- Loader/5 Bootstrap/#504/#280/Registry/main: READ_VERIFIED ngày 2026-10-18.
- PR #5003 trước bổ sung kế hoạch: draft/open, source checks xanh ở SHA 6457f31874d78469a8e32ba2bacc7c2c2a8ce9a2; **phải chạy lại sau commit kế hoạch**.
- T00 source/duplicate audit: VERIFIED_IN_THIS_PLANNING_TURN; T01 upstream license/metadata/file checks: READ_ONLY_BASELINE_VERIFIED nhưng formal security decision/pinned installation vẫn PENDING.
- T02-T14: NOT_ACCEPTED, không suy thành ACTIVE/RUNNING từ tài liệu này.
- CURRENT_BLOCKER: NO_VERIFIED_ISOLATED_SANDBOX_LAUNCH_AND_LIVE_BROWSER_RECEIPT; nhánh/PR không phải blocker cho nghiên cứu còn độc lập.
- NEXT: security T02 (read-only), xây source-grounded sandbox runbook T04; sửa T03 khi và chỉ khi chứng minh bug; không phát hành PC01/app Chrome.
- DRIVE_SYNC=NOT_REQUIRED: tài liệu vận hành động trên nhánh/PR, không đổi entrypoint Loader/main.
