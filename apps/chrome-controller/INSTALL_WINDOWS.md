# TigerIQ Chrome Controller V1 — Cài đặt Windows

## 1. Mục tiêu V1

V1 vận hành 3 Chrome Profile độc lập trên PC01:

- `NV03` — ChatGPT Go — Code Lane A / Web-UI
- `NV05` — ChatGPT Plus — Code Lane B / Core-Backend
- `NV04` — Gemini Pro — Architect / Review / Research

Controller chỉ bind `127.0.0.1`, mở Chrome tuần tự và dùng một hàng đợi UI toàn cục (`concurrency=1`). Không scrape/parse nội dung câu trả lời, không đọc cookie/token/password và không có cơ chế stealth/fingerprint/fake-human.

## 2. Yêu cầu trước khi cài

- Windows 10/11.
- Google Chrome đã cài.
- Node.js >= 20.
- Repo `newsdayads/tigeriq-ai-lab` đã có trên máy để chạy runtime sau khi PR được merge.
- Ba tài khoản đã đăng nhập trong ba Chrome Profile riêng.

> Không dùng ba cửa sổ cùng một Profile. Mỗi NV phải map đúng một Profile Chrome riêng.

## 3. Xác định đúng Chrome Profile đang dùng

Làm một lần cho từng cửa sổ đang đăng nhập:

1. Mở cửa sổ Chrome của NV cần xác định.
2. Mở `chrome://version`.
3. Tìm dòng **Profile Path**.
4. Ví dụ:
   - `C:\Users\<user>\AppData\Local\Google\Chrome\User Data\Default`
   - `C:\Users\<user>\AppData\Local\Google\Chrome\User Data\Profile 1`
   - `C:\Users\<user>\AppData\Local\Google\Chrome\User Data\Profile 2`
5. Phần cuối của đường dẫn (`Default`, `Profile 1`, `Profile 2`) chính là `profileDirectory` dùng trong config.

Ghi lại mapping rõ ràng, ví dụ:

```text
NV03 -> Profile 1
NV05 -> Profile 2
NV04 -> Default
```

Không đoán profile theo vị trí cửa sổ.

## 4. Build source

Tại thư mục repo:

```powershell
npm ci
npm run build
```

Sau build, controller chạy từ:

```text
dist/apps/chrome-controller/src/server.js
```

Dashboard vẫn được đọc từ source path:

```text
apps/chrome-controller/public/index.html
```

Vì vậy khi chạy, Current Directory phải là root của repo.

## 5. Tạo config runtime

Copy file:

```text
apps/chrome-controller/chrome-controller.config.example.json
```

thành một file runtime ngoài source, khuyến nghị:

```text
D:\TigerIQ\Config\chrome-controller.json
```

Sửa các trường sau:

### Chrome executable

Thông thường:

```json
"chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
```

Nếu Chrome ở vị trí khác, dùng đường dẫn thực tế.

### User Data Directory

Nếu 3 NV đang là 3 Chrome Profile trong cùng một Chrome User Data:

```json
"userDataDir": "%LOCALAPPDATA%\\Google\\Chrome\\User Data"
```

Mỗi worker vẫn phải có `profileDirectory` khác nhau.

V1 cũng hỗ trợ `userDataDir` riêng ở từng worker nếu sau này tách hoàn toàn thành ba thư mục User Data độc lập.

### URL làm việc

Điền đúng URL đang dùng cho từng NV:

- NV03: URL Project/Chat TigerIQ của ChatGPT Go.
- NV05: URL Project/Chat TigerIQ của ChatGPT Plus.
- NV04: URL workspace/notebook/chat TigerIQ của Gemini Pro.

Chỉ `https://chatgpt.com/*` và `https://gemini.google.com/*` được chấp nhận ở V1.

## 6. Layout mặc định màn hình 4096x2160

V1 dùng:

```json
"width": 500,
"height": 834,
"gap": 8,
"rightMargin": 8,
"top": 0,
"fallbackWorkAreaWidth": 4096
```

Với work area rộng 4096 px, vị trí mặc định là:

```text
NV03: x=2572, y=0, 500x834
NV05: x=3080, y=0, 500x834
NV04: x=3588, y=0, 500x834
```

Sau khi Extension heartbeat, Controller lấy `workArea` thật từ Chrome `system.display` và áp lại layout. Vì vậy fallback 4096 chỉ dùng lúc khởi động trước khi có heartbeat.

## 7. Cài Extension vào từng Chrome Profile

Thực hiện riêng cho NV03, NV05 và NV04:

1. Mở đúng Chrome Profile.
2. Vào `chrome://extensions`.
3. Bật **Developer mode**.
4. Chọn **Load unpacked**.
5. Chọn thư mục:

```text
<repo>\apps\chrome-controller\extension
```

6. Mở **Details** của extension `TigerIQ Chrome Controller`.
7. Chọn **Extension options**.
8. Gắn đúng Worker ID cho Profile đó:
   - Profile của ChatGPT Go -> `NV03`
   - Profile của ChatGPT Plus -> `NV05`
   - Profile của Gemini Pro -> `NV04`
9. Nhấn **Lưu**.

Mỗi Profile lưu `workerId` riêng trong `chrome.storage.local`; không dùng chung mapping.

## 8. Pacing mặc định

Config V1 mặc định:

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

- Chrome không được mở đồng loạt: worker sau chỉ bắt đầu sau worker trước và khoảng nghỉ tuần tự.
- Sau khi heartbeat, chờ thêm trước khi layout/thao tác.
- Toàn Controller chỉ có một UI action tại một thời điểm.
- Retry hữu hạn; không loop vô hạn.
- Có thể **tăng** các khoảng chờ nếu Chrome/Internet chậm.

Các khoảng chờ dùng để tuần tự hóa và ổn định giao diện, không phải để giả lập người dùng hay né hệ thống phát hiện automation.

## 9. Chạy Controller

PowerShell tại root repo:

```powershell
$env:TIGERIQ_CHROME_CONFIG="D:\TigerIQ\Config\chrome-controller.json"
node dist/apps/chrome-controller/src/server.js
```

Hoặc sau khi script npm được thêm:

```powershell
$env:TIGERIQ_CHROME_CONFIG="D:\TigerIQ\Config\chrome-controller.json"
npm run chrome-controller
```

Khi chạy đúng sẽ log:

```text
CONTROLLER_READY
```

Mở dashboard:

```text
http://127.0.0.1:8798
```

Controller không bind LAN/Tailscale ở V1.

## 10. Test cài đặt — không gửi prompt trước

Test theo thứ tự:

1. Mở Controller.
2. Nhấn **Mở 3 NV tuần tự**.
3. Quan sát:
   - NV03 mở trước.
   - Controller chờ heartbeat + settling.
   - Sau đó mới tới NV05.
   - Cuối cùng NV04.
4. Kiểm tra ba cửa sổ nằm bên phải theo thứ tự `NV03 | NV05 | NV04`.
5. Nhấn **Focus** từng NV, xác minh đúng cửa sổ được đưa lên trước.
6. Nhấn **Sắp xếp** từng NV, xác minh size/layout trở lại đúng vị trí.
7. Chưa test `Giao việc` cho tới khi 6 bước trên ĐẠT.

## 11. Test Giao việc

Sau khi layout/profile mapping ĐẠT, dùng một Work Order nhỏ, không có thao tác bảo mật/tài chính/Production.

Ví dụ:

```text
Đọc trạng thái Project TigerIQ hiện tại và xác nhận bạn đang ở đúng workspace. Không thay đổi tài khoản, bảo mật, Production hoặc MAIN.
```

Controller sẽ:

1. queue thao tác vào hàng đợi toàn cục;
2. điều hướng về `homeUrl` nếu checkbox bật;
3. tìm composer;
4. điền Work Order;
5. kiểm tra challenge trước khi gửi;
6. click đúng nút Send một lần;
7. ghi `SUBMITTED` vào log.

Controller **không đọc/scrape câu trả lời** sau đó.

## 12. Guardrail bắt buộc

Nếu trang xuất hiện một trong các trạng thái sau, worker phải bị khóa:

- CAPTCHA/challenge;
- rate limit / too many requests;
- suspicious/unusual activity;
- re-auth / verify identity;
- security warning.

Khi bị khóa:

1. Không retry vô hạn.
2. Không bypass challenge.
3. Dashboard hiển thị `BLOCKED`.
4. Anh Sơn xử lý/login/xác minh thủ công khi cần.
5. Sau khi điều kiện an toàn được giải quyết, dùng **Bỏ khóa** để cho phép job mới.

## 13. Nút chính trên Dashboard

### Toàn hệ thống

- **Mở 3 NV tuần tự**: mở NV03 -> NV05 -> NV04, không đồng loạt.
- **Tạm dừng**: chặn UI action mới.
- **Tiếp tục**: cho phép UI action mới.
- **KILL SWITCH**: dừng nhận/thực thi command mới và xóa command chưa nhận.

### Từng NV

- **Mở**: mở đúng Chrome Profile.
- **Focus**: đưa đúng cửa sổ lên trước.
- **Sắp xếp**: trả cửa sổ về layout chuẩn.
- **Giao việc**: chọn worker và gửi một Work Order.
- **Bỏ khóa**: chỉ dùng sau khi blocker/challenge đã được xử lý hợp lệ.
- **Đóng**: đóng đúng cửa sổ Chrome của worker qua Extension.

## 14. Log và evidence

Log runtime mặc định:

```text
D:\TigerIQ\Runtime\chrome-controller\chrome-controller.jsonl
```

Log chứa:

- timestamp;
- worker ID;
- action;
- command ID;
- trạng thái/result;
- lỗi/blocker.

Không ghi password, cookie, token hoặc nội dung response của AI.

## 15. Giới hạn V1

- V1 không bảo đảm một website sẽ không bao giờ phân loại hoạt động là automation.
- V1 không scrape response và không tự tạo prompt tiếp theo dựa trên response.
- V1 không bypass CAPTCHA/2FA/rate limit/security challenge.
- Selector composer/send có thể cần cập nhật nếu ChatGPT/Gemini đổi DOM.
- Nếu extension chưa được gắn đúng Worker ID, Controller sẽ timeout heartbeat và không tiếp tục mở đồng loạt worker khác.

## 16. Tiêu chí PASS trước khi dùng thường xuyên

Chỉ coi V1 sẵn sàng sau khi:

1. 3 profile mapping đúng.
2. 3 lần Start All liên tiếp mở đúng thứ tự, không mở đồng loạt.
3. 3 lần layout liên tiếp đúng 500x834 và đúng thứ tự.
4. Focus 3 worker đúng cửa sổ.
5. Một Work Order thử trên từng provider submit đúng một lần.
6. Kill/Pause hoạt động.
7. Một test blocker mô phỏng/local xác nhận worker fail-closed.
8. CI của PR đạt các gate hiện hành.
