# APP CHROME — SPEC LOCK V1
Status: LOCKED
Owner approval: `DUYỆT APP_CHROME_RECOVERY_V1`
Authority issue: #1940
Change rule: chỉ thay khi anh Sơn đưa explicit Owner instruction thay SPEC.

## 1. Mục tiêu duy nhất
App Chrome là bộ điều khiển UI cục bộ cho đúng 3 worker:
- NV02 — ChatGPT Plus — CDP 9222.
- NV03 — ChatGPT Go — CDP 9223.
- NV04 — Gemini Pro — CDP 9224.

Chuỗi điều khiển:
`Worker Utility → Chrome Controller → Direct CDP Bridge → Chrome profile tương ứng`.

App Chrome KHÔNG phải scheduler, dispatcher, backlog reader hoặc work allocator.

## 2. Hành vi bắt buộc
### Boot / start
1. App Chrome tự khởi động.
2. Worker đã mở thì attach; chưa mở thì mở đúng profile.
3. Vào đúng TigerIQ AI Lab / đúng worker context.
4. Tạo hoặc dùng chat phù hợp theo lifecycle.
5. ChatGPT worker chỉ kiểm tra model GPT-5.6 Sol + High/Cao bounded, không loop.
6. Arm continuity loop.

### Loop UI
- Luôn theo dõi trạng thái UI thật: Gửi/Ngừng, uiBusy, DOM/CDP, chat mutation.
- WORKING: không gửi gì thêm.
- READY thật: chờ delay đã arm rồi gửi đúng 1 câu ngắn local có prefix worker.
- STALLED: recovery bounded riêng worker.
- BLOCKED/security: fail closed; không bypass.
- Pause/Owner hold: thắng mọi automation.

### Prompt
Prompt chỉ là câu ngắn local, ví dụ:
- `02 - Làm tiếp`
- `03 - Tiếp tục`
- `04 - Xử lý tiếp`

Dùng pool local 21 câu. Không prompt điều phối dài. Không giao việc mới qua App Chrome.

### Anti-spam
- Sau dispatch: `awaitingWorkStart=true`.
- Không dispatch lần 2 cho đến khi quan sát WORKING thật.
- Chỉ sau WORKING → READY mới arm lượt kế tiếp.
- Một lượt = một dispatch.
- Không double-send từ Controller + Bridge.

### Recovery / maintenance
- UI pacing: 3–8 giây.
- Theo dõi UI thường xuyên; không spam.
- F5: 5–20 phút, chỉ khi an toàn; không cắt WORKING.
- Network/page failure: retry bounded; không loop vô hạn.
- Restart Chrome riêng worker: 2–4 giờ hoặc recovery cần thiết; không restart worker khác nếu không liên quan.
- Planned restart: lưu/checkpoint → archive khi thao tác được → mở đúng profile → đúng project/chat context → model check bounded → arm continuity.
- Reboot PC01: App Chrome + supervisor/watchdog phải tự lên và converges.

## 3. Cấm tuyệt đối trong App Chrome
- Không dùng Core assignment làm gate để quyết định có gửi continue hay không.
- Không dùng `READY_UNASSIGNED` để bắt worker đứng chờ.
- Không scan/rank/claim GitHub backlog.
- Không tự chọn P0/P1/P2/P3/P4/P5.
- Không gửi role-fallback/self-claim prompt.
- Không dùng Core / queue / GitHub làm nguồn assignment.
- Không tự thay đổi SPEC từ issue/checkpoint/code cũ.
- Không phục hồi nguyên một bản cũ nếu kéo regression đã biết quay lại.

## 4. Priority / conflict rule
`Explicit Owner instruction > APP_CHROME_SPEC_LOCK > WORKING_RULES > IMPLEMENTATION_PLAN > EXECUTION/EVIDENCE > checkpoint/issue/code/history cũ`.

Nếu checkpoint hoặc code hiện tại xung đột SPEC: checkpoint/code phải sửa; SPEC không tự đổi.

## 5. Acceptance bất biến
A1 NV02/NV03/NV04 READY → đúng 1 prompt ngắn prefix tương ứng.
A2 WORKING → 0 duplicate dispatch.
A3 Không Core/GitHub/queue/assignment gate trong continuity decision.
A4 Không role-fallback/self-claim prompt.
A5 Model check bounded; không model loop.
A6 F5/restart không cắt WORKING; recovery bounded.
A7 3 worker live đạt trên PC01.
A8 Reboot PC01 → tự khởi động và converges.
A9 Evidence + exact head + handoff đủ để NEW CHAT tiếp tục không thiết kế lại.
