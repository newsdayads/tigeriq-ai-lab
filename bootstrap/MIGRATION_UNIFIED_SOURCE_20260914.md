# TIGERIQ — MIGRATION TO UNIFIED SOURCE ENTRY POINT
Date: 2026-09-14
Status: Migration Packet

## Mục tiêu
Đồng nhất ChatGPT Plus, ChatGPT Go và Gemini Pro về một entry point nguồn duy nhất trên GitHub để loại bỏ việc duy trì 3 bộ 5 file thủ công.

## Authority sau migration
- Canonical repository: `newsdayads/tigeriq-ai-lab`
- Canonical branch: `main`
- Single entry point: `bootstrap/00_TIGERIQ_LOADER.md`
- Bootstrap canonical: `bootstrap/01...`, `02...`, `03...`, `05...`, `06...`
- Dynamic state: `docs/CURRENT_STATE.md`, CENTRAL #280, Registry #335, Interaction #504 và work/evidence liên quan.

## Sau khi PR này merge và regression đạt
### ChatGPT Plus
- XÓA khỏi Project Source: 5 Bootstrap upload cũ.
- THÊM/GIỮ: đúng 1 bản `00_TIGERIQ_LOADER.md`.

### ChatGPT Go
- XÓA Bootstrap copy riêng nếu có.
- THÊM/GIỮ: cùng `00_TIGERIQ_LOADER.md`.

### Gemini Pro
- XÓA khỏi Nguồn: 5 file Drive Bootstrap đang gắn.
- THÊM/GIỮ: một nguồn web trỏ tới Loader raw trên GitHub.
- Các link động #280/#335/#504/CURRENT_STATE có thể giữ trong giai đoạn regression; sau khi xác minh Loader/web retrieval ổn định có thể bỏ để giao diện chỉ còn một entry point.

## Không xóa dữ liệu thật
- Không cần xóa 5 file Drive thật; chúng được hạ xuống mirror/reference.
- Không dùng Drive làm authority nếu xung đột GitHub `main`.

## Khi source thay đổi sau này
- Nội dung Bootstrap/dynamic state: sửa GitHub qua branch → review/gate → merge.
- Không tải lại 5 file vào 3 tài khoản.
- Chỉ thay Loader ở các tài khoản nếu chính locator/loading contract của Loader thay đổi; đây phải là ngoại lệ hiếm.

## Regression
1. `vy`.
2. `bc`.
3. `đưa prompt làm việc`.
4. Kiểm tra CENTRAL = #280, Registry = #335, CURRENT_STATE lấy đúng từ GitHub hiện hành.
5. Command hợp lệ resolve đúng registry.
6. Command không đăng ký/disabled fail closed.
7. Không dùng bản Drive/file upload cũ khi GitHub unavailable.
