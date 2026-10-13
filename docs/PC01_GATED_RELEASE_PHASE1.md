# PC01 — cổng phát hành độc lập khỏi GitHub main — giai đoạn 1

**Quyền:** Owner 2026-10-13; #4725 - [P0][PC01][TRIỂN KHAI] Phát hành có kiểm soát không dùng RDC — giai đoạn 1.
**Trạng thái:** CODE TRÊN NHÁNH / CHƯA PHÁT HÀNH; KHÔNG coi tài liệu này là phiếu cho phép cài PC01.
**Bề mặt:** TigerIQ Core, OpenClaw, typed PC01 operator, Core Runtime Updater. App Chrome LOCAL-only, Android, Vercel Production và thay đổi bảo mật ngoài phạm vi.

## Root cause hiện hữu
- `scripts/tigeriq-core/update-core-runtime.ps1` trước khi sửa poll `origin/main` và chọn commit đã có GitHub CI và Queue Hygiene đạt để áp dụng trực tiếp. Hợp nhất không được đồng nghĩa với Owner đã duyệt phát hành PC01.
- Một số lần sửa đã rollback thành công, nhưng đó không chứng minh mọi thành phần đều được quản lý qua bản kê phát hành hoặc cơ chế khôi phục toàn diện.
- Updater đồng thời phụ trách Web Control, Coding Lane và các tác vụ có liên quan: thay đổi nó có thể làm chậm bản phát hành các nhóm khác. Không tự hợp nhất rồi giả định không có ảnh hưởng.

## Thiết kế an toàn (nhánh #4727)
- Mã sơ kiểm không thực hiện cài: `scripts/tigeriq-core/pc01-release-preflight.mjs`.
- Bộ chặn có kiểu của updater nằm trong `scripts/tigeriq-core/pc01-release-guard.ps1`, được nạp từ **installed runtime source**, không nạp từ bản candidate chưa duyệt.
- File local approval được đặt tại `C:\ProgramData\TigerIQCoreRelease\core-runtime-release-approval.json`. Chỉ một kênh **cục bộ và đã cấp quyền** được tạo/đổi nó. Updater KHÔNG tự tạo approval từ CI, merge, PR, issue/comment hoặc mệnh lệnh do Worker tự viết.
- File một-lượt cập nhật `C:\ProgramData\TigerIQCoreRelease\core-runtime-release-attempt.json` giữ trạng thái STARTED/COMMITTED/ROLLED_BACK. Không lặp lại cùng requestId hoặc targetSha nếu đã từng thử, kể cả sau lỗi.
- Cổng từ chối mọi target/baseline không phải SHA 40 ký tự, phiếu thiếu/hết hạn, sai resource scope, sai danh sách component, thay đổi Web/Coding/LiveBridge không thuộc pilot, hoặc target đã thử.
- `approved=true` trong file **không phải chứng minh danh tính** người duyệt. Nguồn tín nhiệm phụ thuộc quy trình ghi local độc lập, người thao tác có quyền thực, kiểm tra ACL/thẩm quyền và biên nhận. Khi chưa xác minh được thì **CHƯA ĐỦ CỔNG TIN CẬY**, không phát hành.

### File approval local — chỉ là ví dụ cấu trúc, TUYỆT ĐỐI không dùng làm biên nhận phát hành
```json
{
  "schema": "TIGERIQ_PC01_RELEASE_APPROVAL_V1",
  "scope": "TIGERIQ_PC01_GATED_RELEASE_NO_RDC_PHASE1",
  "requestId": "EXAMPLE-NEVER-APPLY-0001",
  "targetSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "expectedInstalledSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "rollbackSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "approved": true,
  "components": ["core", "updater"],
  "expiresAtUtc": "2000-01-01T00:00:00Z"
}
```
File ví dụ luôn hết hạn nên không thể áp dụng. Khi chạy thật lấy đúng target SHA/installed SHA từ live và phiếu quyền được xác thực. Không tạo khóa mới hay cấp quyền hệ thống chỉ để vượt cổng.

## Vùng thực thi được bảo vệ
- Cấu phần Updater và bộ kiểm chứng phiếu chạy từ `C:\\ProgramData\\TigerIQCoreRelease`. Vùng này chỉ cho **SYSTEM** và **Administrators** ghi, không sửa D:\\TigerIQ\\State hay App Chrome.
- Đường làm việc mã nguồn trên PC01 và hệ thống watchdog là các phụ thuộc phải kiểm chứng. `main` không tự phát hành và không là phiếu duyệt.
- Cổng cài bootstrap phải kiểm chứng cả SHA-256 tệp updater và guard do nhánh đã qua CI trước khi thay đổi Scheduled Task; nếu thiếu biên nhận thì hoàn nguyên mà không ghi nhận DONE.

## Cổng triển khai lần đầu — KHÔNG ĐƯỢC BỎ QUA
1. Đọc installed SHA, task ownership, updater file path, cấu hình và bản rollback known-good trên PC01 bằng kênh typed/status; RDC chỉ khi đã được cho phép và đường trực tiếp không đủ.
2. Đối chiếu toàn bộ chênh lệch từ **installed SHA đến target**, phát hiện thành phần không thuộc scope và owner/lease đang chạy; không đụng App Chrome.
3. Đảm bảo quy trình có thể tạm giữ **updater cũ** trước merge, rồi kích hoạt bằng một hành động cấp quyền; old updater chưa có cổng nên nếu không thể kiểm soát cửa sổ tự cập nhật thì KHÔNG MERGE.
4. Chỉ sau khi có biên nhận Owner/đường local có quyền mới stage chính xác commit với manifest/bản sao rollback và áp dụng bản đầu tiên có kiểm soát.
5. Khi đã cài bản mới: xác minh `installedSha`, Core/OpenClaw/Updater/typed PC01 health, không trùng tiến trình và App Chrome bất biến; kiểm tra cổng từ chối source mới chưa có phê duyệt.
6. Nếu thất bại: dừng, dùng đường phục hồi known-good được kiểm chứng, không tự retry quay vòng hoặc cấp rộng quyền để sửa nhanh.

## Nghiệm thu
- Exact HEAD: required CI, Queue Hygiene, Vercel Verify đạt (Vercel chỉ là CI check, không phải phát hành Vercel).
- E2E PowerShell mock: phiếu thiếu/sai/expired/replay/out-of-scope phải từ chối; dữ liệu đúng chỉ PASS gate tiền phát hành, KHÔNG được tạo side-effect cài.
- 10 công việc nguồn/trạng thái tiêu biểu có RDC=0, đếm qua biên nhận thực.
- 3 phiên bản pilot liên tiếp với source SHA, installed SHA, baseline và rollback proof thực; không mất dữ liệu/ID/secret, không chồng PID.
- Mọi biên nhận runtime phải là dữ liệu PC01 mới. CI/source PASS không phải live install PASS.

## Trạng thái cần báo
- `SOURCE_ONLY`: branch/PR/tests hiện có.
- `GATED_RELEASE_READY`: kiểm tra quyền local, rollback, version, ACL và 1-writer đã xác minh.
- `INSTALLED_VERIFIED`: PC01 readback đúng commit, các dịch vụ khỏe.
- `DONE`: các nghiệm thu cuối cùng đạt, có links/receipt và không có blocker.

Chưa đạt cổng nào thì giữ `OPEN`, không tuyên bố bản mã trên `main` tự chứng minh PC01 đã cài.
