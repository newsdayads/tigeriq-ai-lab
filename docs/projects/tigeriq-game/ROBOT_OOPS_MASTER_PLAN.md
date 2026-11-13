# TIGERIQ GAME — ROBOT OOPS! / KẾ HOẠCH TỔNG V1
Ngày lập: 2026-10-23 (Asia/Ho_Chi_Minh)
Dự án: TIGERIQ_GAME_ROBOT_OOPS
Điểm gốc: https://github.com/newsdayads/tigeriq-ai-lab/issues/5179
Trạng thái: LẬP KẾ HOẠCH; chưa có game chạy hoặc nguồn mã sản phẩm nghiệm thu.
Tên game: ROBOT OOPS! — Chỉ Sửa 1 Lệnh (**tên làm việc**, cần kiểm tra tên/nhãn hiệu trước phát hành).
Nguồn chuẩn: GitHub main + 5 Bootstrap + CURRENT_STATE + Issue #504 / #280 / #335.
Nguồn sự thật cho kế hoạch: file này sau khi PR hợp nhất; trước thời điểm đó là nhánh cùng 15 Issue đã được tạo.
Quyết định công nghệ: ưu tiên Web 2D với TypeScript + Phaser + Vite; ADR G04 có quyền chọn lựa tương đương theo bằng chứng. KHÔNG lệ thuộc Unity giai đoạn đầu.

## A. Vấn đề, mục tiêu và phạm vi
Owner muốn học được kỹ năng sản xuất, phát hành và vận hành game qua sản phẩm đơn giản, có tiềm năng thu hút, thử nhỏ trước khi đầu tư game chuyên nghiệp.
Vòng chơi: người chơi xem robot chuẩn bị thực hiện chuỗi lệnh; chỉ được thay đúng **1** lệnh tại một vị trí; chạy robot, quan sát hành động hài, thắng nếu hoàn thành mục tiêu.
Điểm khác biệt cần thử: **mỗi câu đố chỉ sửa một lệnh**, trực quan, một ngón tay, vòng chơi nhanh, dễ chia sẻ video. Không có bằng chứng thị trường đảm bảo doanh thu; cạnh tranh và trùng ý tưởng phải rà trước phát hành.
Không làm trong bản đầu: 3D, Unity build, đăng nhập, thu tiền, quảng cáo thật, đa người chơi, backend, lưu PII, ứng dụng Store, sự kiện, shop hoặc đấu xếp hạng.
Mục tiêu kiểm chứng: 5 màn chạy trên trình duyệt điện thoại thật; nếu tốt, mở 10 màn, rồi chọn Android/kinh doanh.

## B. Ranh giới dự án mới
- Mã dự án riêng: TIGERIQ_GAME_ROBOT_OOPS; có thư mục tài liệu `docs/projects/tigeriq-game` và bộ issue G01–G14.
- Mã nguồn game giai đoạn đầu đặt tại **`apps/tigeriq-game/` như một ứng dụng/gói độc lập trong kho chuẩn**, không dùng chung mã hoặc dữ liệu với Driver/Chrome/App hệ thống; việc tạo kho mã nguồn GitHub riêng chỉ là phương án tách sau, không khóa việc G01–G14 khi kết nối chưa có hành động tạo repository.
- Không tạo một queue điều phối song song với CENTRAL; Issue dự án là hồ sơ sản phẩm, mỗi Gxx là Work Order phụ thuộc; executor phải claim trên hệ thống hợp lệ trước khi ghi runtime.
- Không tự thay bootstrap/Loader vì dự án mới không thay chính sách; DRIVE_SYNC=NOT_REQUIRED.

## C. Nguồn lực đã kiểm tra, giả định và giới hạn
- PC01 có đường kết nối điều khiển từ xa, tài nguyên phần cứng tham chiếu issue #936; có các phiên nguồn ai, nhưng không suy ra coding worker đang rảnh.
- Trên PC01 phát hiện thư mục metadata `Unity 6000.3.7f1` nhưng không tìm thấy `Unity.exe` tại đường dẫn chuẩn; Unity/Android Player KHÔNG tính là sẵn sàng.
- Có quyền truy cập GitHub repo TigerIQ main; không tự đồng nhất quyền truy cập GitHub với lease Core.
- Bản Web tĩnh có thể chạy bằng máy phát triển hiện có; quyền xuất bản công khai/hosting/miền/các chứng thư phải xác minh theo dịch vụ cụ thể.
- Dự toán chi phí tiền mặt MVP: mục tiêu 0đ phần mềm mới, dùng tài nguyên miễn phí/hợp lệ; chưa cộng công sức và phí mạng/hosting tiềm ẩn. Không phát sinh phí khi chưa có phép.

## D. Phân rã 14 phần việc, phụ thuộc, đầu ra, nghiệm thu
| Mã | Issue | Phụ thuộc | Đầu ra | Cổng nghiệm thu |
|---|---|---|---|---|
| G01 | #5180 | — | Phạm vi, đặt tên, tài nguyên, vị trí repo | Bản quyền/giấy phép, không trùng scope; kho nguồn riêng nếu đủ quyền |
| G02 | #5181 | G01 | Thiết kế luật, 5 màn đặc tả | Luật chỉnh đúng 1 lệnh, 5 màn có nghiệm có thể xác minh |
| G03 | #5182 | G02 | UX 2D tối ưu điện thoại | Điều khiển bằng chạm, xem được ở màn hình 320–430px, dễ hiểu |
| G04 | #5183 | G01 | Dựng nguồn Web/CI/tests | `build`, `lint`, `test` có log thành công |
| G05 | #5184 | G02,G04 | Engine mô phỏng tất định + solver | Test va chạm, hướng, lệnh, 1 thay đổi, màn vô nghiệm |
| G06 | #5185 | G03,G05 | 5 màn thật xuyên suốt | 5/5 màn được validator xác minh; có bản chơi điện thoại |
| G07 | #5186 | G06 | Hình ảnh/âm thanh/sao lưu tiến trình | Có quyền tài nguyên, lưu/khôi phục/đặt lại đạt |
| G08 | #5187 | G05,G06,G07 | QA & chạy trên thiết bị | Không có lỗi chặn, log build + chạy thật |
| G09 | #5188 | G06 | Đo sự kiện tối thiểu, bảo vệ dữ liệu | Định nghĩa và kiểm thử không đếm trùng, không thu PII ngầm |
| G10 | #5189 | G08,G09 | Thử 30–50 người & báo cáo học được | Số mẫu thực, nguồn dữ liệu, GO/PIVOT/STOP |
| G11 | #5190 | G07,G10 | Chỉnh thiết kế và 10 màn | 10/10 màn có nghiệm, regressions pass, phiên bản |
| G12 | #5191 | G10,G11 | Quyết định Android + bản thử nếu đủ quyền | Có biên nhận build/cài/chạy; không tuyên bố đã phát hành |
| G13 | #5192 | G10 | Thẩm định doanh thu/pháp lý/tên/quyền | Đánh giá chính sách quốc gia và nền tảng trước nạp thật |
| G14 | #5193 | G11,G12,G13 | Kế hoạch vận hành 30/60/90 ngày | Sự cố, nội dung, đo lường, ROI, điều kiện dừng |

### Thứ tự ưu tiên hiệu quả
Chuỗi chính: G01 → [G02,G04] → [G03,G05] → G06 → [G07,G09] → G08 → G10 → [G11,G13] → G12 → G14.
Độc lập hợp lệ: G03 có thể chạy cùng G04; G13 có thể nghiên cứu trước dữ liệu G10 nhưng không nghiệm thu dự báo doanh thu cho đến khi dữ liệu người chơi về.
Không mở công việc G11–G14 khi nghiệm thu tiền đề chưa đạt. Mỗi phần việc có đúng một phạm vi ghi; một scope không có hai người ghi đồng thời.

## E. Mốc kiểm soát sản phẩm (M0–M5)
**M0 — Đã lập hồ sơ**: issue gốc + đủ 14 Gxx + file kế hoạch hợp nhất main. Chỉ M0 khi readback main thành công, không phải khi PR mới mở.
**M1 — Kiểm thử kỹ thuật**: luồng build/test chạy trên executor thật + có xác nhận nơi lưu mã và giấy phép.
**M2 — Bản mẫu chơi được**: 5 màn, 1 lần thay lệnh, mô phỏng, thua/thắng, nút thử lại, tối ưu di động.
**M3 — Sẵn sàng thử với người dùng**: QA/tính ổn định/lưu tiến trình, quyền riêng tư, công cụ ghi phản hồi tối thiểu.
**M4 — GO/PIVOT/STOP**: 30–50 người, phân tích hành vi, phân biệt xu hướng với kết luận thiếu mẫu; quyết định có bằng chứng.
**M5 — Mở rộng**: 10 màn + bản thử Android (nếu hợp lệ) + thẩm định kinh doanh/pháp lý + vận hành 30/60/90.

## F. Thời gian và nhân sự
- **Ước lượng có điều kiện (không phải hứa):** 5–10 ngày làm việc cho 5 màn khi công cụ và nhân sự thực thi đã sẵn sàng. Độ trễ tạo repo/thiết lập môi trường/CI có thể kéo dài hơn.
- G08 QA thường 2–5 ngày làm việc tùy thiết bị/lỗi; G10 thử 30–50 người 1–3 tuần tùy tuyển người, không giả đã có mẫu.
- Kinh doanh và phát hành app chính thức chỉ lên lịch sau G10/G13; không có ngày chắc chắn.
- Vai trò: Owner quyết định định hướng, ngân sách, hợp đồng, hành động pháp lý; Vy điều phối và xác minh; executor năng lực lập trình được chọn theo Registry/Core khi bắt đầu G04/G05; QA độc lập hoặc test tự động theo chính sách.
- Không phân công mặc định NV02/NV06/NV07 khi chưa xác minh quyền, lease, hạn mức và trạng thái phục vụ.

## G. Tiêu chí sản phẩm và số đo
- Kỹ thuật: 5/5 màn có ít nhất một lời giải sau đúng 1 lần thay; mô phỏng tất định, cấm xử lý vô hạn; test bộ luật và dữ liệu; mở lại bảo toàn tiến trình; không lỗi chặn ở thiết bị thử.
- UX: thao tác một ngón, văn bản dễ hiểu, không chỉ dùng màu, có bật/tắt âm thanh, màn đầu hướng dẫn bằng thao tác.
- Đo cơ bản: số người chơi hợp lệ, bắt đầu màn 1, hoàn thành màn 1/3/5, số lần chơi lại, thời gian hiểu luật, chủ động yêu cầu chơi thêm.
- Mức sàng lọc thử nghiệm (giả thuyết mục tiêu, không phải benchmark thị trường): ≥80% hiểu luật trong 30s; ≥70% qua 3 màn; ≥30% nói muốn chơi tiếp; không có lỗi chặn nghiêm trọng. Mẫu 30–50 **chưa đủ** dự báo retention D1/D7 hay khả năng kiếm tiền. Nếu nhỏ hoặc lệch mẫu, ghi nhận định tính và tiến hành thử tiếp.
- Cổng GO đòi cả ổn định kỹ thuật và tín hiệu người chơi; nếu chưa đạt → sửa hoặc dừng, không tự thêm nạp tiền.

## H. Thiết kế kinh doanh có kiểm soát
1. Chỉ khi G10 GO mới nghiên cứu quảng cáo thưởng, gói bỏ quảng cáo, nâng cấp mang tính thẩm mỹ; tuyệt đối không ép mua để thắng các màn đầu.
2. Không tích hợp thanh toán thật, tiền ảo đổi tiền thật hoặc cá cược trong MVP.
3. Cần đối chiếu quy định trò chơi điện tử tại Việt Nam, phân loại trò chơi, giấy phép/xác nhận, quyền phát hành và điều kiện tài khoản Google Play/App Store. Không diễn giải việc chạy Web thành miễn toàn bộ nghĩa vụ pháp lý.
4. Quyền mã, ảnh, nhạc, nhãn hiệu và dữ liệu người chơi phải có bằng chứng trước khi đưa lên cửa hàng.
5. Dự phóng thu nhập chỉ từ dữ liệu thật: người dùng mới, tỷ lệ quay lại, quảng cáo tự nguyện, doanh thu ròng sau phí, chi phí hỗ trợ; không đặt con số hứa hẹn trước.

## I. Sổ rủi ro / ứng phó
| Rủi ro | Tác động | Giảm thiểu | Cổng kiểm tra |
|---|---|---|---|
| Ý tưởng gần game đã tồn tại | IP/thị trường | Mã, hình, màn tự làm; tra tên/nhãn; luật riêng | G01,G02,G13 |
| Đường thực thi PC01 chưa sẵn sàng | Chậm tiến độ | Web 2D build độc lập; kiểm tra môi trường bằng log | G04,G08 |
| Robot/lời giải thiếu nhất quán | Không chơi được | Solver, kiểm tra tự động mọi bản đồ và trạng thái vòng lặp | G05,G06 |
| Người chơi không hiểu luật | Bỏ game | Hướng dẫn tương tác, thử với người chưa biết trước | G03,G10 |
| Game ít hấp dẫn | Không tạo doanh thu | Dừng ở 5 màn; thử nhóm nhỏ, có lựa chọn PIVOT | G10 |
| Rò dữ liệu/vi phạm nền tảng | Pháp lý/uy tín | Thu tối thiểu, có đồng ý, không thu PII | G09,G13 |
| Chi phí ẩn / nạp tiền quá sớm | Lỗ, vi phạm | 0đ MVP, phân cổng phí, tách kinh doanh | G13 |
| Nhiều worker sửa trùng | Mất mã | Mỗi scope chỉ 1 writer, PR/CI, kiểm chứng lease | Tất cả |
| Tên thương mại bị trùng | Không phát hành được | Tên làm việc, kiểm tra thực tế trước xuất bản | G01,G13 |
| Nguồn đã trên GitHub nhưng host chưa triển khai | Báo DONE sai | Kiểm tra file main, build thật, chạy thật và bằng chứng | G08,G12 |

## J. Quy trình QA, bằng chứng, phát hành
- Quy tắc: branch → PR → exact-head CI → review hợp lệ/miễn review đúng scope → merge → readback `main`; không ghi trực tiếp `main`.
- Dữ liệu nghiệm thu cho mỗi Gxx: issue số, commit SHA, PR, tên bài test và kết quả, môi trường, thiết bị thực tế (nếu cần), ngày/giờ, lỗi còn mở.
- Không coi việc tạo Issue, nhánh, mô tả hay tạo PR là đã triển khai game.
- Android production / phí / secret / phân quyền / hành động không đảo ngược đều là cổng riêng; có phê duyệt đã cấp theo đúng phạm vi thì không xin lại.
- Khi có lỗi: phân loại Gxx bị chặn; phần không phụ thuộc vẫn có thể thực hiện; không giả đã tự chạy nền.

## K. Danh sách hồ sơ sản phẩm
- Parent issue: #5179
- G01–G14: #5180–#5193 (kiểm tra liên kết từng issue).
- Kế hoạch này: `docs/projects/tigeriq-game/ROBOT_OOPS_MASTER_PLAN.md`
- Thiết kế game: `docs/projects/tigeriq-game/ROBOT_OOPS_GAME_DESIGN.md`
- Kiểm thử & dữ liệu: `docs/projects/tigeriq-game/ROBOT_OOPS_ACCEPTANCE.md`

## L. Bước kế tiếp hợp lệ sau khi M0 được nghiệm thu
1. G01: xác minh địa chỉ mã nguồn độc lập, kiểm tra quyền sử dụng và tên.
2. G02/G04: đặc tả luật và trình dựng Web 2D.
3. G05/G06: viết mã mô phỏng và thử 5 màn, test trên thiết bị thật.
Không tuyên bố GO, release, doanh thu hay 100% nếu các cổng trên chưa có biên nhận.

## MÔ HÌNH THỰC THI HIỆN HÀNH (23/10/2026)
Xem [ROBOT_OOPS_WORKFLOW_V2.md](./ROBOT_OOPS_WORKFLOW_V2.md): một thẻ tổng đọc và 14 thẻ thực thi V2 có phụ thuộc bằng số Issue; nhân sự nhận việc theo đúng năng lực, một phạm vi một chủ ghi; giới hạn số lần thử, nghiệm thu và STOP/GO rõ. Nhóm dự án khai báo tại `projects/tigeriq-game/project.yaml`, không tạo hàng đợi cạnh tranh.

**Điều kiện nhánh phát triển sau thử nghiệm:** G11–G14 giữ `WAIT_GO_DECISION` cho đến khi có biên nhận G10 GO; đóng G10 alone không tự mở việc phát triển. STOP/PIVOT không mở G11–G14, chỉ được chuyển trạng thái bằng điều phối có quyền và ghi biên nhận. Đây là cổng quản trị hữu hạn, không giả Core đã tự hiểu kết quả GO/STOP.


## M6 — S10 5G / PC01 — cổng thử game trên máy thật (Owner 23/10/2026)
**Thiết bị:** điện thoại Samsung S10 5G được Owner thông báo kết nối PC01, ADB phải xác nhận `device` + serial đúng trước thao tác. Không suy kết nối thật chỉ từ thông báo.
**Phân công vào việc hiện có, không tạo thẻ:**
- **G06 #5185 — S03 MOBILE SMOKE / UNBLOCK:** sau khi nguồn 5 màn đã merge + local build OK, chạy chính game Web 2D trên trình duyệt S10 5G qua URL nội bộ/dev server được quyền hoặc `adb reverse`, **không phát hành Production**. Thao tác thật ít nhất: mở app, thay đúng 1 lệnh, nhấn chạy, thắng/thua/thử lại, đi từ màn 1 đến màn 5 và cảm ứng một ngón. Lưu ảnh/video/log, thiết bị và SHA. Nếu chưa được xác minh thì G06 vẫn `WAIT_BROWSER_E2E`; không mở G07 dựa trên ảnh mockup.
- **G08 #5187 — DEVICE REGRESSION / INDEPENDENT QA:** sau khi G05+G06+G07 đạt, kiểm thử lặp trên S10 5G (5/5 màn, lưu/khôi phục, âm thanh, chạm, xoay màn, hồi quy); mở rộng thêm viewport/thiết bị khác khi có, không giả có 2 điện thoại. Lưu báo cáo QA và lỗi thực, không dùng cùng G06 làm bằng chứng QA độc lập.
- **G12 #5191 — ANDROID PACKAGE** (sau GO của G10): có thể dùng lại S10 5G để thử APK/TWA/Capacitor, nhưng không chặn G06/G08 vì chưa có APK.

**Thứ tự ADB bắt buộc:** preflight quyền/tài nguyên → `adb devices -l` (device=authorized, chọn serial thật, không đoán) → đọc trạng thái pin thật qua `adb shell dumpsys battery` → **trước thử** dùng `adb shell dumpsys battery set level 100` để **mô phỏng báo cáo pin 100%**, đọc lại xác nhận → mở game/test/capture → **luôn hoàn nguyên** `adb shell dumpsys battery reset` dù PASS hay FAIL, xác nhận nguồn pin thật được trả về. Lệnh ADB không sạc vật lý; nếu muốn pin thực 100% phải sạc và kiểm tra ngoài ADB. Không chạy trên thiết bị không đúng serial/unauthorized, không thay quyền ADB hoặc cấu hình thiết bị lâu dài.

**Điều kiện mở G06:** chỉ dùng bề mặt điều khiển PC01/device-bound hiện có với quyền đúng scope, one-writer/lease và biên nhận. `NO_PC01_SHELL=true` tiếp tục khóa shell tổng quát và sửa mã PC01; chỉ có thể dùng **lệnh ADB giới hạn đúng S10 5G** khi được định tuyến và xác minh quyền thiết bị. Nếu không có bề mặt ADB hợp lệ thì ghi blocker chính xác `S10_ADB_TOOL_OR_DEVICE_UNAVAILABLE`, không phá chính sách để vượt cổng. Không đăng nhập, nạp tiền, mua ứng dụng, sửa Production hay thu PII.
**Nghiệm thu:** phiên thử có SHA build, phiên bản trình duyệt, xác nhận pin giả lập 100% trước thao tác, ảnh/video hoặc biên nhận máy thật, bảng kết quả 5/5 màn, lỗi và chứng cứ đã reset battery. Thiếu một phần ghi CHƯA NGHIỆM THU, không tự đếm 100%.


## OWNER DIRECT — Quyền MCP/RDC → PC01 → ADB S10 5G (23/10/2026)
AUTHORITY=OWNER_CHAT_2026_10_23_S10_ADB_MCP_RDC|PROJECT=tigeriq-game|RESOURCE_SCOPE=ROBOT_OOPS_G06_G08_S10_DEVICE_ONLY
MCP_RDC_PC01_ADB=SCOPED_AUTHORIZED|PRODUCTION_RELEASE=DENIED|REPO_SOURCE_MUTATION_BY_PC01=DENIED

- **Phạm vi cấp:** Owner cho phép ChatGPT/MCP Remote Desktop Commander vào PC01 để điều khiển ADB **chỉ** cho game ROBOT OOPS! trên Samsung S10 5G đã xác nhận `SM-G977N`, giới hạn G06 #5185 (browser E2E) và G08 #5187 (QA độc lập khi đủ phụ thuộc). G12 vẫn phụ thuộc quyết định GO; quyền này không mở xuất bản hay cài APK Production.
- **Bề mặt đã xác minh qua RDC trên PC01:** công cụ `D:\TigerIQ\Tools\platform-tools\adb.exe`; `adb devices -l` trả đúng 1 máy authorized `device`, model `SM-G977N`. Không dựa trên biến môi trường PATH (ở lần đọc PATH không có `adb`).
- **Chọn kết nối RDC:** mỗi thao tác độc lập phải áp dụng `docs/RDC_REMOTE_POOL.md`, đọc quota và PC01 Online, dùng link/deviceId tương ứng. Không hardcode tài khoản, không luân chuyển để vượt chặn bảo mật, không thực thi lại mutation không rõ kết quả.
- **Cổng một người ghi:** đối chiếu Core/device owner & lease của đúng phạm vi trước khi thao tác đổi pin, mở trình duyệt, chạm hoặc quay màn hình. Không giành quyền của job/actor hiện hữu; nếu đang bận thì CHỜ đúng thiết bị. G06 chưa được DONE cho đến khi E2E có chứng cứ.
- **Ngoại lệ hẹp:** `NO_PC01_SHELL=true` vẫn có hiệu lực đối với shell tùy ý, chỉnh mã trên PC01 hoặc ứng dụng khác. Chỉ cho phép `RDC.start_process`/MCP thao tác **danh sách lệnh ADB quy định** dùng đường dẫn binary chính xác và serial được xác nhận ở phiên đó: `devices -l`, `shell getprop ro.product.model`, `shell dumpsys battery`, `shell dumpsys battery set level 100`, `shell dumpsys battery reset`, `reverse`/remove reverse port dành cho game, `shell am start` mở URL game nội bộ, `shell input tap/swipe/keyevent` tương tác game, ảnh/video/log không chứa dữ liệu cá nhân. Cấm mọi lệnh ADB khác (install/uninstall, wipe, root, security setting, tài khoản, dữ liệu cá nhân, key, production).
- **Trạng thái pin đã đo:** ADB `dumpsys battery` trả `level:100` và `UPDATES STOPPED` **trước khi phiên test mới bắt đầu**; đó là override ADB tồn tại sẵn, không phải chứng cứ pin vật lý 100%. Trước khi test phải đọc baseline lại và bảo đảm level mô phỏng 100; **không ghi đè hoặc reset override của actor khác nếu chưa chứng minh được quyền sở hữu**, chỉ reset nếu phiên thử của chính actor đó đã thiết lập override và không có xung đột. Nếu override tồn tại trước phiên, giữ nguyên baseline hoặc phục hồi theo receipt từ actor có quyền; chưa xác minh cleanup thì báo WAIT.
- **Không có quyền host toàn cục chỉ từ tài liệu:** quyền Owner này áp dụng nhiệm vụ và bề mặt MCP/RDC đang kết nối; việc Core/NV khác có tự gọi được RDC cần kiểm tra connector binding và lease riêng, không giả tự động chạy nền.
- **Bằng chứng:** lệnh/biên nhận thiết bị đã chạy, model/serial che một phần, SHA build, pin giả lập trước test, hành động 5 màn, ảnh/video và cleanup đúng baseline. Chỉ đóng G06 hoặc G08 sau nghiệm thu đúng scope.
