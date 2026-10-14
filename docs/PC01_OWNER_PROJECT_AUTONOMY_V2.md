# PC01 — quyền Owner toàn nguồn dự án V2
Ngày: 15/10/2026. Authority: lệnh trực tiếp hiện hành của anh Sơn “mở Full hết”; chính sách tương tác canonical và Issue #280 - [CENTRAL][ĐIỀU PHỐI] Hàng đợi thực thi an toàn + lô việc Owner tạm hoãn.

## Quyền và hiệu lực
Owner cho phép thay đổi cơ chế quyền phát hành TigerIQ và triển khai qua RDC trong phạm vi dự án. Đây là thay đổi security/permission đã được yêu cầu rõ; không hỏi lại cùng quyền.
Chỉ một quản trị viên SYSTEM/Administrators được Owner cấp phép mới tạo `C:\ProgramData\TigerIQCoreRelease\core-runtime-owner-project-policy.json`. Mã nguồn candidate/merge/AI không tự tạo grant này.

Policy `OWNER_PROJECT_AUTONOMY_V2` bỏ giới hạn 10 tệp Core + 2 tệp Coding, quota 12 bản và hạn 30 ngày cho phát hành nguồn TigerIQ. Grant có hiệu lực đến khi Owner thu hồi bằng `enabled=false`. Cho phép toàn nguồn repository chuẩn, gồm Core, Coding, Web, OpenClaw, Updater/guard, workflow và mã chính sách/bảo mật. Không có Owner approval riêng lặp lại từng phiên bản.

## Kiểm chứng thực thi
Updater hiện có là bộ đối chiếu định kỳ; không phụ thuộc một bình luận Issue tình cờ phát sinh sau CI.
Mỗi lần chỉ nhận GitHub main đúng SHA, ancestry từ bản cài, Git provenance cho regular files/deletions và CI của chính main. PR-head CI không thay cho main CI. Khóa một writer, ghi STARTED/COMMITTED/ROLLED_BACK, sức khỏe và rollback vẫn hoạt động; không báo giả PASS hoặc DONE.
Policy grant và thư mục cha vẫn chỉ SYSTEM/Administrators được ghi, không nhận symlink/reparse-point hay candidate policy. Thay đổi mã guard được đồng bộ từ cùng snapshot đã cấp phép, có backup theo hash và phục hồi cùng updater khi rollback.
Không tự retry một target đã COMMITTED/ROLLED_BACK hoặc bỏ qua attempt STARTED chưa xử lý.

## Provisioning có bằng chứng
Grant là bản ghi quản trị được cấp quyền từ hội thoại Owner và RDC; `authorizationSource=OWNER_DIRECT_CHAT_RDC`, URL bản ghi canonical, `activatedBy=OWNER-RDC-...`, SHA bản cài tại lúc kích hoạt, thời gian UTC. Không giả đây là phiếu Owner GitHub/OIDC.
Bootstrap phát hành snapshot V2 qua thủ tục Windows quản trị đã được Owner cho phép: kiểm tra source/main/CI/dirty/lease, backup ticket/guard/updater/state, tạo một approval operational record exact SHA, dùng updater hiện hành, đọc COMMITTED và sức khỏe. Sau đó đồng bộ guard từ chính SHA đã nghiệm thu rồi tạo grant. Không chỉnh ACL, không giả chữ ký.
Không có grant hoặc grant disabled: cổng ticket V1/V2 cũ giữ nguyên. Grant lỗi phải có lý do thật, không âm thầm nâng quyền.

## Giới hạn thực tế
Đây là quyền phát hành nguồn và runtime thuộc dự án TigerIQ, không phải quyền vượt chính sách nền tảng/công cụ hoặc OAuth của dịch vụ bên ngoài. Không đưa credential/secret thật vào repository.
Chức năng chỉ được deploy ở các bề mặt mà pipeline/updater tương ứng thật sự triển khai. Snapshot App Chrome trong GitHub vẫn là mirror; runtime App Chrome có nguồn local riêng. Android/hosting/ứng dụng khác vẫn cần executor/build/deploy phù hợp; grant nguồn không tự tạo capability.
Không tự xóa OWNER_HOLD/lease của writer khác, tiêu tiền hay sửa tài khoản bên ngoài.
AI nạp chính sách hiện hành: kế thừa quyền đúng việc, không đặt gate tự phát; một bước chưa executable phải checkpoint và tiếp tục việc độc lập. Quyền không phải bằng chứng AI đang chạy: vẫn nghiệm thu job/lease/receipt thật.

## Trạng thái
SOURCE_MIGRATION: kiểm thử và main merge phải đọc bằng chứng thực.
RUNTIME_ACTIVATION: chỉ ACTIVE sau grant readback + guarded deployment receipt + health.
FULL_PLATFORM_ACCESS: không được tuyên bố.

