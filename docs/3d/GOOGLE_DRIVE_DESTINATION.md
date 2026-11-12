# TIGERIQ 3D — GOOGLE DRIVE ĐÍCH LƯU TRỮ CHUẨN

OWNER_DIRECT=true | DATE=2026-11-12 | SCOPE=3D_ARTIFACT_STORAGE | STATUS=OWNER_APPROVED_STORAGE_ROUTING

## Đích lưu chuẩn (đã xác minh)
- Google Drive folder: **TigerIQ 3D**
- Folder ID: `1QFje3OTZfDIeCMfrH5aHoMWqXNwJP2xM`
- URL: https://drive.google.com/drive/folders/1QFje3OTZfDIeCMfrH5aHoMWqXNwJP2xM
- Được tạo tại Drive root, quyền riêng tư chỉ owner; metadata được đọc lại sau khi tạo.
- Hiện có V2.1 ZIP: `TIGER_P1S_V21_FILES_TAI_LAI_20261112.zip`, file ID `1XtlsRRT1UiVi8z4eVUjpmrxBAwm_BBtL`, metadata xác minh nằm trong folder trên.

## Quy tắc mặc định đã được Owner ủy quyền
1. Với **mọi sản phẩm 3D TigerIQ** được tạo hoặc chỉnh sửa trong tương lai (STL, 3MF, STEP/SCAD/CAD, ảnh xem trước, bản vẽ, ZIP, file G-code đã được xác minh): ưu tiên lưu lên **chính folder trên** qua Google Drive connector trực tiếp. Không hỏi lại nơi lưu khi quyền kết nối còn hợp lệ.
2. Nếu các tệp gồm nhiều bản: đặt tên rõ **tên sản phẩm / version / công dụng / trạng thái**, phân biệt `MODEL_UNSLICED`, `SLICED_VERIFIED`, `PRINT_TESTED`. Không đánh đồng file 3MF chứa mesh với project đã Slice.
3. Trước khi upload, kiểm tra folder ID/metadata; với mỗi artifact đã tồn tại, so sánh danh tính và phiên bản để tránh tạo file trùng. Chỉ cập nhật file cũ nếu đúng mục tiêu và có kiểm chứng, không tùy tiện ghi đè bản in đã duyệt.
4. Sau upload, **đọc lại metadata** của từng file và xác minh `parent_ids` chứa folder ID chuẩn; cung cấp đường dẫn Drive thực tế. Nếu upload không thực hiện được, báo `DRIVE_UPLOAD_PENDING`; không tự tuyên bố đã lưu.
5. Tệp gốc có trên PC01 nhưng không truyền được tới Drive trực tiếp: nêu rõ nút thắt ở bước chuyển file. Không dựng giả URL, không coi link sandbox là bản lưu bền vững. Không đưa file lên nơi công cộng chỉ để khắc phục việc truyền tải.
6. Quy tắc chỉ cho phép **lưu trữ bản thiết kế**: KHÔNG bao gồm quyền tự gửi lệnh in lên Bambu P1S, tự chia sẻ công khai, tự đăng MakerWorld, trả phí, hay thay đổi thiết bị. Các thao tác đó giữ cổng duyệt riêng.
7. Quy tắc áp dụng cho Agent/Work/chat mới **khi đọc tài liệu nguồn GitHub main này**. Không được khẳng định mọi chat/ứng dụng tự đồng bộ khi chưa kiểm chứng.

## Căn cứ / đường dẫn
- Owner yêu cầu: 12/11/2026 — "Tạo thư mục TigerIQ 3D trên Google Drive rồi sau này upload các sản phẩm làm lên trên này. Fix cứng luôn".
- GitHub main Loader: `bootstrap/00_TIGERIQ_LOADER.md`
- Skill CAD ứng viên: `docs/skills/product-3d-engineering/SKILL.md` (PR #5714, chưa ACTIVE tại thời điểm ghi nhận).

Không tạo thêm hệ thống điều phối hoặc nguồn sự thật; đây là quy tắc đích lưu của luồng 3D nằm dưới GitHub main.
