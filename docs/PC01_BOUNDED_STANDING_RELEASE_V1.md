# PC01 — ủy quyền phát hành thường trực có giới hạn V1

Ngày: 2026-10-14. Nguồn: Owner phê duyệt cụ thể trong chat, Issue #280 hiện hành. **Trạng thái nguồn: CHƯA KÍCH HOẠT.**

## Thiết kế tin cậy

- Mã mới trên GitHub **không cấp quyền cho chính mình**. Nếu không có `C:\ProgramData\TigerIQCoreRelease\core-runtime-standing-policy.json` được tạo từ sự kiện Owner có GitHub Actions OIDC hợp lệ, mọi yêu cầu tự phát hành bị từ chối `PC01_STANDING_NOT_ACTIVATED`.
- Kích hoạt **một lần** chỉ sau khi phiên bản chứa cơ chế mới được phát hành theo cổng ký thủ công hiện hữu, không bypass, không ký bằng GitHub connector thay Owner. Bình luận đăng **trực tiếp bởi Owner** trên Issue #4725, mã xác thực OIDC workflow main và đọc lại đúng bình luận nguyên bản.
- Phiếu cố định: `SAFE_CORE_CODING_V1`, thời hạn 30 ngày, tối đa 12 phiên bản thực thi, tối đa 20 commits trong một lần, tối đa 30 tệp; chỉ 2 nhóm mã `core`, `coding` thuộc **danh sách tệp exact** dưới đây. Updater hiện **CHƯA CÓ BẤT KỲ GIT BLOB ĐƯỢC GHIM ĐỂ TỰ PHÁT HÀNH**, do thay đổi cơ chế release/updater là mặt phẳng bảo mật và không thể tự phê duyệt. Mở phạm vi này phải qua cơ chế Owner riêng với blob SHA cụ thể và kiểm thử.
- Máy PC01 phải đọc policy từ vùng chỉ SYSTEM/Administrators được phép ghi, không từ GitHub candidate/PR/issue thông thường. Kích hoạt đọc lại GitHub main == installed SHA, không nhận bình luận cũ/sửa, không dựa trên profile kết nối ChatGPT.
- Cổng nhận sự kiện tự động: ưu tiên **kênh issue/issue_comment có OIDC ký sẵn** trong workflow hiện đang cài trên PC01. Chỉ sự kiện của Issue điều phối #280 có chứng thực GitHub đọc lại mới kích hoạt kiểm tra nguồn. Phải xác minh `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify` SUCCESS trên đúng một SHA. Sự kiện chỉ là lời nhắc kiểm tra, **không phải giấy cấp quyền**. Không đổi nội dung workflow được bảo vệ để hợp thức hóa phát hành. Chưa nghiệm thu đường kết nối Core nhận tín hiệu này.
- Source diff so với installed phải đi đúng ancestry; tất cả tệp đúng allowlist. Từ chối luôn `.github/`, release-guard, OIDC, core.mjs, thư mục bí mật, App Chrome, Production, Android, mã cập nhật quyền, mọi đường dẫn chưa ghim.
- Một writer bằng khóa `wx`; lock cũ không được tự xóa/lấy cắp. Chỉ xoay phiếu cũ có biên nhận COMMITTED/ROLLED_BACK; phiếu chưa dùng chặn phiếu kế tiếp. Trừ lượt phát hành trước khi ghi phiếu; sự cố có thể hao lượt nhưng không được cấp dư quyền. Ticket V2 10 phút phải đi qua cổng PowerShell đã cài, backup và rollback như trước.

## Kích hoạt bắt buộc — sau nghiệm thu phát hành chính cơ chế V1

Khi GitHub main bằng PC01 installed SHA vừa ký, Owner đăng **trực tiếp** vào Issue #4725, đúng 3 dòng sau, thay `<SHA_IN_PC01>` bằng SHA đọc từ biên nhận thực của PC01:

```text
TIGERIQ_PC01_STANDING_ENABLE_V1
BASELINE_SHA=<SHA_IN_PC01>
POLICY=SAFE_CORE_CODING_V1
```

**Lưu ý:** ChatGPT/công cụ GitHub không tự bình luận thay Owner để tạo sự kiện này. Chỉ ủy quyền bằng ngôn ngữ trong chat **không** sinh ra tệp SYSTEM đã ký.

## Danh mục nguồn an toàn ban đầu

- Core: `backlog-hygiene.mjs`, `github-backlog-policy.mjs`, `manager-batch-policy.mjs`, `manager-cycle-policy.mjs`, `manager-job-policy.mjs`, `job-recovery-policy.mjs`, `context-gateway.mjs`, `objective-local-routing.mjs`, `work-routing-policy.mjs`, `work-order-lifecycle-v2.mjs` tại `apps/tigeriq-core/`.
- Coding Lane: `ai-json-transport.mjs`, `nonblocking-manager-tick.mjs` tại `apps/tigeriq-coding-lane/`.
- Bài kiểm thử tại `tests/` chỉ được đi cùng nguồn hợp lệ; thay đổi mỗi kiểm thử không đủ điều kiện cấp phiếu.
- Các chức năng cần sửa ngoài danh mục phải vào PR kiểm thử và **Owner phê duyệt phát hành riêng**; không tự thêm vào allowlist từ bản Candidate.

## Kiểm thử và trạng thái

Đã bổ sung unit tests từ chối sự kiện Owner giả, workflow giả, CI thiếu, hết hạn/quota, đường dẫn bảo mật, chưa kích hoạt. PASS chỉ ghi sau khi CI đúng HEAD thành công.

Nghiệm thu cuối: (1) ký hợp lệ phát hành phiên bản chứa cơ chế; (2) bình luận Owner kích hoạt một lần, xác minh policy SYSTEM; (3) một PR **thực, được phép** tiếp theo auto issued ticket và COMMITTED; (4) xác minh rollback, watchdog và RDC bất biến; (5) nghiệm thu độc lập Core 2 công việc thật DONE và việc kế tiếp đã nhận hợp lệ. Không chạy canary lặp cùng SHA hay đóng Issue #280 trước khi có biên nhận.

**CURRENT_STATE=SOURCE_ONLY|STANDING_AUTH_NOT_ACTIVATED|PC01_SIGNED_BOOTSTRAP_REQUIRED|FULL_AUTO_NOT_PROVEN.**

## Phụ lục chặn chuyển đổi 14/10/2026

- PR #4777 là **nháp**; phục hồi chính xác Git blob workflow đang cài và bổ sung kiểm thử sự kiện đã ký. Đoạn gọi phát hành từ luồng nhận issue thực tế trong `apps/tigeriq-core/core.mjs` bị cổng công cụ chặn, **chưa tích hợp**, không đủ điều kiện hợp nhất hay phát hành.
- Không tự dùng quyền RDC hoặc sửa `pc01-release-guard.ps1` để bỏ qua cổng. Chỉ tiếp tục khi có đường thực thi an toàn được phép.
- Nghiệm thu đứng cuối: có biên nhận PC01 cài SHA, Owner kích hoạt chính sách riêng, 1 bản tự phát hành đúng danh mục, 2 công việc Core thật DONE, tự nhận việc khác.
