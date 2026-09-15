# TigerIQ Chrome Controller V1 — Cài đặt Windows / PC01

## 1. Mục tiêu V1

V1 vận hành 3 Chrome Profile độc lập:

- `NV03` — ChatGPT Go — Code Lane A / Web-UI
- `NV02` — ChatGPT Plus — Code Lane B / Core-Backend
- `NV04` — Gemini Pro — Architect / Review / Research

Controller chỉ bind `127.0.0.1`, mở Chrome tuần tự và dùng một hàng đợi UI toàn cục (`concurrency=1`). Không scrape/parse nội dung câu trả lời, không đọc cookie/token/password và không có cơ chế stealth/fingerprint/fake-human.

## 2. Cách cài chuẩn trên PC01

PC01 là runtime/diagnostics machine, **không build source tại PC01**. Build/test/package chạy trên GitHub Actions. PC01 chỉ tải artifact đã qua CI và chạy runtime.

Workflow tạo artifact:

```text
Chrome Controller Package
```

Artifact có dạng:

```text
TigerIQ-Chrome-Controller-V1-<PR hoặc run>
```

Bên trong đã có:

```text
dist/apps/chrome-controller/src/*.js
apps/chrome-controller/extension/*
apps/chrome-controller/public/index.html
apps/chrome-controller/chrome-controller.config.example.json
apps/chrome-controller/Start-ChromeController.ps1
apps/chrome-controller/INSTALL_WINDOWS.md
VERSION.txt
```

## 3. Yêu cầu trên PC01

- Windows 10/11.
- Google Chrome đã cài.
- Node.js >= 20 đã có sẵn cho runtime.
- Ba tài khoản đã đăng nhập trong ba Chrome Profile riêng.
- Không cần `npm install`, `npm ci`, TypeScript hay build tool trên PC01.

## 4. Tải và giải nén artifact

Sau khi workflow `Chrome Controller Package` PASS:

1. Mở GitHub repository `newsdayads/tigeriq-ai-lab`.
2. Vào **Actions**.
3. Mở run `Chrome Controller Package` tương ứng PR/commit cần test.
4. Tải artifact `TigerIQ-Chrome-Controller-V1-...`.
5. Giải nén vào thư mục cố định, khuyến nghị:

```text
D:\TigerIQ\ChromeControllerV1
```

Sau khi giải nén phải thấy:

```text
D:\TigerIQ\ChromeControllerV1\dist\apps\chrome-controller\src\server.js
D:\TigerIQ\ChromeControllerV1\apps\chrome-controller\extension\manifest.json
```

## 5. Xác định đúng Chrome Profile đang đăng nhập

Làm một lần cho từng cửa sổ:

1. Mở đúng cửa sổ Chrome của NV.
2. Vào `chrome://version`.
3. Tìm **Profile Path**.
4. Ví dụ:

```text
C:\Users\<user>\AppData\Local\Google\Chrome\User Data\Default
C:\Users\<user>\AppData\Local\Google\Chrome\User Data\Profile 1
C:\Users\<user>\AppData\Local\Google\Chrome\User Data\Profile 2
```

5. Phần cuối (`Default`, `Profile 1`, `Profile 2`) là `profileDirectory`.

Ghi mapping thật, không đoán theo vị trí cửa sổ:

```text
NV03 -> <profile ChatGPT Go>
NV02 -> <profile ChatGPT Plus>
NV04 -> <profile Gemini Pro>
```

## 6. Tạo config runtime

Tạo thư mục:

```text
D:\TigerIQ\Config
```

Copy:

```text
D:\TigerIQ\ChromeControllerV1\apps\chrome-controller\chrome-controller.config.example.json
```

thành:

```text
D:\TigerIQ\Config\chrome-controller.json
```

Sửa các trường sau.

### Chrome executable

Thông thường:

```json
"chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
```

### Chrome User Data

Nếu cả ba là các Profile khác nhau trong cùng Chrome User Data:

```json
"userDataDir": "%LOCALAPPDATA%\\Google\\Chrome\\User Data"
```

Mỗi worker vẫn phải có `profileDirectory` khác nhau.

### Worker mapping

Ví dụ:

```json
"workers": [
  {
    "id": "NV03",
    "role": "CODE_WEB_UI",
    "profileDirectory": "Profile 1",
    "homeUrl": "https://chatgpt.com/..."
  },
  {
    "id": "NV02",
    "role": "CODE_CORE_BACKEND",
    "profileDirectory": "Profile 2",
    "homeUrl": "https://chatgpt.com/..."
  },
  {
    "id": "NV04",
    "role": "ARCHITECT_REVIEW_RESEARCH",
    "profileDirectory": "Default",
    "homeUrl": "https://gemini.google.com/..."
  }
]
```

Điền đúng URL Project/Chat/Workspace hiện tại của từng NV. V1 chỉ chấp nhận `https://chatgpt.com/*` và `https://gemini.google.com/*`.

## 7. Layout mặc định màn hình 4096x2160

Config mặc định:

```json
"width": 500,
"height": 834,
"gap": 8,
"rightMargin": 8,
"top": 0,
"fallbackWorkAreaWidth": 4096
```

Nếu work area rộng đúng 4096 px:

```text
NV03: x=2572, y=0, 500x834
NV02: x=3080, y=0, 500x834
NV04: x=3588, y=0, 500x834
```

Khi Extension heartbeat, Controller lấy `workArea` thật từ Chrome `system.display` và áp layout lại; giá trị 4096 chỉ là fallback lúc chưa có heartbeat.

## 8. Cài Extension vào từng Profile

Thực hiện riêng trên NV03, NV02, NV04:

1. Mở đúng Chrome Profile.
2. Vào `chrome://extensions`.
3. Bật **Developer mode**.
4. Chọn **Load unpacked**.
5. Chọn:

```text
D:\TigerIQ\ChromeControllerV1\apps\chrome-controller\extension
```

6. Mở **Details** -> **Extension options**.
7. Chọn Worker ID đúng profile:
   - ChatGPT Go -> `NV03`
   - ChatGPT Plus -> `NV02`
   - Gemini Pro -> `NV04`
8. Nhấn **Lưu**.

Mỗi Profile lưu worker ID riêng trong `chrome.storage.local`.

## 9. Pacing mặc định

```json
"betweenWorkerLaunchMs": 30000,
"postReadySettlingMs": 10000,
"minUiActionGapMs": 8000,
"commandTimeoutMs": 60000,
"workerReadyTimeoutMs": 180000,
"maxRetries": 1,
"retryBackoffMs": 15000
```

Ý nghĩa:

- Không mở 3 Chrome đồng loạt.
- Worker sau chỉ được mở sau khi worker trước đã heartbeat/settle và qua hàng đợi launch.
- Toàn Controller chỉ có một UI action tại một thời điểm.
- Retry hữu hạn; không vòng lặp vô hạn.
- Có thể **tăng** thời gian chờ nếu máy/Internet chậm.

Pacing dùng để tuần tự hóa và ổn định UI, không phải để giả lập con người hay né cơ chế phát hiện automation.

## 10. Chạy Controller

Mở PowerShell và chạy:

```powershell
Set-Location "D:\TigerIQ\ChromeControllerV1"
.\apps\chrome-controller\Start-ChromeController.ps1 -Config "D:\TigerIQ\Config\chrome-controller.json"
```

Khi đúng, console ghi `CONTROLLER_READY`.

Mở:

```text
http://127.0.0.1:8798
```

V1 không expose Controller ra LAN/Tailscale.

## 11. Test cài đặt — chưa gửi prompt

1. Nhấn **Mở 3 NV tuần tự**.
2. Xác minh NV03 mở trước.
3. Chờ Controller nhận heartbeat + settling.
4. Sau đó NV02 mới mở.
5. Cuối cùng NV04 mới mở.
6. Xác minh thứ tự cửa sổ bên phải: `NV03 | NV02 | NV04`.
7. Nhấn **Focus** từng NV và kiểm tra đúng cửa sổ.
8. Nhấn **Sắp xếp** và kiểm tra size 500x834.
9. Chỉ test `Giao việc` sau khi các bước trên ĐẠT.

## 12. Test Giao việc

Dùng một Work Order nhỏ, không thay đổi bảo mật/tài chính/Production/MAIN. Ví dụ:

```text
Đọc trạng thái Project TigerIQ hiện tại và xác nhận bạn đang ở đúng workspace. Không thay đổi tài khoản, bảo mật, Production hoặc MAIN.
```

Controller sẽ:

1. queue request vào hàng đợi toàn cục;
2. điều hướng về `homeUrl` nếu được chọn;
3. tìm composer;
4. điền Work Order;
5. kiểm tra challenge trước khi gửi;
6. click nút Send một lần;
7. ghi `SUBMITTED` vào log.

Controller **không đọc/scrape câu trả lời** và không tự tạo prompt kế tiếp từ Output.

## 13. Guardrail fail-closed

Worker bị khóa nếu phát hiện:

- CAPTCHA/challenge;
- rate limit / too many requests;
- suspicious/unusual activity;
- re-auth / verify identity;
- security warning.

Khi bị khóa:

1. dừng retry;
2. không bypass;
3. dashboard hiện `BLOCKED`;
4. xử lý đăng nhập/xác minh thủ công nếu cần;
5. chỉ nhấn **Bỏ khóa** sau khi điều kiện an toàn đã được xử lý.

## 14. Nút Dashboard

Toàn hệ thống:

- **Mở 3 NV tuần tự** — Start All theo NV03 -> NV02 -> NV04.
- **Tạm dừng** — chặn action mới.
- **Tiếp tục** — mở lại action mới.
- **KILL SWITCH** — dừng command mới và xóa command chưa nhận.

Từng NV:

- **Mở** — mở đúng Chrome Profile.
- **Focus** — đưa đúng cửa sổ lên trước.
- **Sắp xếp** — áp lại layout.
- **Giao việc** — gửi một Work Order.
- **Bỏ khóa** — mở worker sau khi blocker đã được xử lý.
- **Đóng** — đóng đúng window qua Extension.

## 15. Log runtime

Mặc định:

```text
D:\TigerIQ\Runtime\chrome-controller\chrome-controller.jsonl
```

Log chỉ giữ timestamp, worker ID, action, command ID, status/error. Không ghi password, cookie, token hoặc nội dung AI response.

## 16. Tiêu chí PASS trước khi dùng thường xuyên

1. 3 Profile mapping đúng.
2. 3 lượt Start All liên tiếp mở đúng thứ tự và không đồng loạt.
3. 3 lượt layout đúng 500x834.
4. Focus đúng cả 3 window.
5. Một Work Order thử trên từng provider chỉ submit một lần.
6. Pause/Kill hoạt động.
7. Blocker/challenge test fail-closed.
8. CI Verify + Queue Hygiene Verify + Vercel Online Verify PASS.
9. Workflow `Chrome Controller Package` PASS và artifact được tạo đúng.

## 17. Giới hạn V1

- Không thể bảo đảm website sẽ không bao giờ phân loại hoạt động là automation.
- Không scrape Output, không tự loop prompt dựa trên Output.
- Không bypass CAPTCHA/2FA/rate-limit/security challenge.
- Selector composer/send có thể cần cập nhật khi ChatGPT/Gemini thay DOM.
- Nếu Extension chưa gắn đúng Worker ID, Start All sẽ timeout heartbeat và không tiếp tục mở hàng loạt worker khác.
