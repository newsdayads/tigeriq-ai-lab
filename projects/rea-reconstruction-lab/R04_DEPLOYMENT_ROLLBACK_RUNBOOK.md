# REA GH-4780 — R04: Kế hoạch triển khai tái lập và dry-run không ghi

**Trạng thái:** Quy trình và mô phỏng nguồn, **KHÔNG** phải cài đặt, chạy REA, tạo máy ảo hay nghiệm thu host. Mốc R03 đã hoàn tất phần [thiết kế](./R03_SANDBOX_ARCHITECTURE.md). Các cổng R05 (quyền/lease), R06 (cài thử) và R07 (MCP runtime) độc lập, chưa nghiệm thu.

## 0. Trạng thái PC01 mới và lệnh dự phòng không đổi PATH (18/10/2026)

> **Chỉ hiệu đính hướng dẫn sau cài đặt, KHÔNG thay pin R04 lịch sử.** Phần R04 bên dưới mô phỏng nguồn `rea-agents@6.4.0`; phiên kiểm chứng PC01 ngày 18/10/2026 chạy **REA 6.5.0**. Phiên PowerShell RDC không tìm thấy `rea` trong Process/User/Machine PATH, dù `D:\TigerIQ\Tools\rea-agent\rea.cmd` tồn tại. Không được suy ra bản cài lỗi hoặc tự đổi PATH hệ thống.

**Preflight chỉ đọc trên PC01 đã được cấp quyền**, gọi bằng đường dẫn tuyệt đối, không cài/cập nhật REA hay chạy ứng dụng người dùng:

```powershell
$reaCmd = 'D:\TigerIQ\Tools\rea-agent\rea.cmd'
if (-not (Test-Path -LiteralPath $reaCmd -PathType Leaf)) { throw 'REA_CMD_NOT_FOUND' }
& $reaCmd --version
if ($LASTEXITCODE -ne 0) { throw 'REA_VERSION_CHECK_FAILED' }
& $reaCmd mcp doctor
if ($LASTEXITCODE -ne 0) { throw 'REA_MCP_DOCTOR_FAILED' }
```

- **Biên nhận thực tế:** `rea.cmd --version = 6.5.0`, `mcp doctor: healthy=true`, 5/5 kiểm tra, 207/207 MCP tools. [Đọc biên nhận PC01](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6238265562).
- **PATH:** `Get-Command rea` trong phiên mới là bước đọc; chỉ báo boolean về PATH Process/User/Machine, không đăng toàn bộ đường dẫn. Chèn tạm vào `$env:Path` cho một tiến trình **không** chứng minh cấu hình User/Machine đã được sửa.
- **R11:** Mẫu OS `calc.exe`/`mscorlib.dll` đã kiểm tra tĩnh chỉ chứng minh khả năng công cụ, **không nghiệm thu** R11. [Biên nhận hai định dạng](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6238333800). Cần mẫu EXE/APK/DB do Owner chỉ định và readback/Owner acceptance trước khi báo DONE.
- **Cấm trong preflight:** `rea setup`/`update`/`install`, sửa registry hoặc Environment PATH vĩnh viễn, khởi động ứng dụng mẫu, đọc secrets, vượt lease/cổng quyền PC01.

## 1. Bản cố định và điều kiện đầu vào

- Phần mềm nguồn `rea-agents@6.4.0`, upstream commit `a56f7bb668ab23fec8d33f7af353ac7ed2fe1895`.
- Chỉ dùng `jq 1.7` và JSON giả lập đã xác minh ở R08; không đọc hồ sơ người dùng, credential, PC01 HOME hay ứng dụng chưa có quyền.
- Trước bước cài **trong tương lai**, đối chiếu **byte của artifact chính thức** với SRI/digest được chứng thực trong checkpoint R02; đối chiếu cả addon Windows theo nền tảng. Không coi chỉ ghi lại hash trong tài liệu là chứng minh tệp trên VM đã kiểm tra.
- Môi trường yêu cầu: VM dùng một lần tách khỏi host, không admin, network deny-all cả ingress/egress/DNS/proxy tại tầng ngoài, input chỉ đọc, output tạm, không chia sẻ host file/USB/IPC; áp hạn mức tối đa 2 vCPU, 2048 MiB RAM, 4096 MiB disk, 64 tiến trình, 600s. Đó là **yêu cầu thiết kế**, không phải trạng thái đã thực thi.
- Không tạo/chạy VM, không cấp quyền thiết bị, không gọi npm install, REA setup/update/uninstall, không dùng Codex/RDC/PC01 trong R04.

## 2. Trình tự lệnh/kiểm tra và cách thu biên nhận khi được phép R05+

Các mục dưới đây là **runbook**, không phải script được phép tự chạy. Chủ ghi hợp lệ phải duyệt từng bước, lưu biên nhận ở kho riêng đã loại dữ liệu nhạy cảm.

| Bước | Công việc dự kiến của executor đúng quyền | Dấu hiệu PASS sau khi thực thi thật | Nếu FAIL |
|---|---|---|---|
| P01 | Đọc binary/npm tarball bytes từ nguồn đã khóa; so khớp SHA512 SRI + addon digest | Digest khớp official verified receipt | STOP; không cài |
| P02 | Kiểm tra quyền thiết bị và lease nguyên tử R05 (resource ID, scope, fencing, TTL, heartbeat) | Receipt còn hiệu lực, đúng máy và đúng thao tác | STOP; không chiếm khóa |
| P03 | Đối chiếu VM cách ly và network deny ở hypervisor, đo quota | Readback riêng về VM/egress/CPU/RAM | STOP; không mở quyền mạng |
| P04 | Chỉ-đọc bản kê cấu hình **allowlist công khai** trước cài: OS, Node/npm, phiên bản dịch vụ và trạng thái process *được phép quan sát* | Bản kê baseline đã lọc; không ghi đường dẫn/secret ra Issue | STOP; không chạy tiếp |
| P05 | Sao lưu cấu hình **chỉ thuộc phạm vi được duyệt** sang kho riêng bảo vệ; ghi checksum mà không lộ nội dung | Backup manifest, scope và checksum | STOP; không áp dụng thay đổi |
| P06 | Kiểm thử khôi phục bản sao trên **fixture VM dùng một lần**, không chạm host | Digest sau phục hồi khớp bản gốc | STOP; ghi rủi ro phục hồi |
| P07 | Stage input mẫu, gói offline vào VM tạm, không bind host path | Readback file pin và quyền chỉ-đọc | STOP; hủy vùng stage |
| P08 | Xác minh cổng R06 ngay trước bước tạo/thay đổi trong VM | Receipt action-specific còn hiệu lực | STOP; không cài |
| P09 | Cài trong VM **được phép**, không phải PC01 hay môi trường chính thức | Mã, log cài và manifest đối chiếu; không mạng | STOP; rollback |
| P10 | Chỉ mở tool theo cổng R07, không mặc định MCP stdio cô lập network | Approval allowlist thực, không có browser/ADB tự bật | STOP; rollback |
| P11 | Chạy smoke giới hạn đúng mẫu trong VM, giới hạn thời gian và tiến trình | Log không dữ liệu nhạy cảm, exit code và dấu vết công cụ | STOP; rollback |
| P12 | Đọc lại allowlisted host state; đối chiếu baseline riêng | Không có host thay đổi ngoài phạm vi đã duyệt | STOP; rollback |
| P13 | Thu hồi token tạm (nếu có), ngắt VM, xóa VM theo quyền | Receipt teardown đúng VM ID/fencing | STOP; kiểm tra bằng người có quyền |
| P14 | Đối chiếu trạng thái host cuối cùng với baseline | Dấu vết không bị thay đổi, không còn VM/process | Nếu khác: sự cố R05/R06, không báo DONE |

**Lệnh kiểm tra chỉ ở bề mặt được phép:** `node --version`, `npm --version` và công cụ tính SHA512 **chỉ với tệp thuộc workspace đã duyệt**; `sha512sum <isolated-rea-tarball>` là minh họa Linux và `Get-FileHash -Algorithm SHA512 <isolated-rea-tarball>` là minh họa PowerShell, **không lệnh nào được chạy trên PC01 từ runbook này**. Số liệu cần đối chiếu theo từng biên nhận; không lưu token, đường dẫn tư nhân, môi trường người dùng hay nội dung file.

## 3. Rollback và xử lý sự cố

Trong mô hình, mỗi điểm lỗi P01–P14 chuyển sang quy trình 6 bước: dừng tiến trình VM từ controller ngoài; thu hồi token/ngắt mạng VM; kiểm chứng checksum backup và chỉ phục hồi cấu hình đã được duyệt; hủy VM đúng ID theo quyền; đọc lại host allowlist so với baseline; lưu audit đã lọc. **Mọi bước rollback mô phỏng không phải biên nhận đã phục hồi thật.** Nếu thiếu quyền khôi phục/không chứng minh được host nguyên trạng, xử lý là `WAIT_AUTHORIZED_RECOVERY`, không dùng khóa của writer khác.

## 4. Dry-run offline KHÔNG GHI

Dùng đúng mã nguồn `r04-deployment-dry-run.mjs`. Không import filesystem, network, subprocess, không đọc host/cấu hình, không mở tệp hay chạy REA. Chỉ dựng **danh sách hành động và nhánh rollback mô phỏng** từ hằng số cố định, xuất JSON ra stdout (ngoại lệ duy nhất là mã trả về CLI). Không có nhánh bật `execution_authorized`.

```bash
node projects/rea-reconstruction-lab/r04-deployment-dry-run.mjs --dry-run
node projects/rea-reconstruction-lab/r04-deployment-dry-run.mjs --dry-run --failure=VERIFY_R06_PERMISSION_BEFORE_ANY_INSTALL
npx vitest run tests/rea-reconstruction-lab/r04-deployment-dry-run.test.ts
```

Trả `DRY_RUN_FINISHED_NOT_DEPLOYED` hoặc `DRY_RUN_ABORT_ROLLBACK_SIMULATED`; `executed=false`, `host_verified=false`, `release_authorized=false` trong mọi phản hồi. Cần kiểm tra 14 nhánh lỗi, thứ tự rollback, bảo vệ thông tin riêng tư và cú pháp lệnh. CLI trên máy khác chỉ chứng minh **chạy được mô phỏng** ở đúng môi trường đó.

## 5. Cổng chuyển R04 → R05

R04 nghiệm thu khi: tài liệu mô tả pin/sao lưu/pre-post/rollback/sự cố đã hợp nhất, test dry-run nguồn thành công ở đúng SHA và Issue tích checkbox R04 với liên kết. **Không đánh đồng** với nghiệm thu PC01, native addon thực, Core lease hoặc khôi phục thật. Từ R05 trở đi cần issuer/owner thật và ủy quyền action-specific, không tự tạo kế hoạch thành quyền. Work Order #4780 tiếp tục OPEN cho tới toàn bộ milestone hợp lệ.
