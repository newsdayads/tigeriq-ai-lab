# NV03 — quyết định hủy mở rộng tự nhận P1–P5 (lưu hồ sơ lịch sử)

**Trạng thái: HỦY THEO OWNER 2026-10-11 / NOT_PLANNED. Không kích hoạt.**

- Owner rút lại quyền mở rộng ngày 2026-10-10: `NV03_SELF_PULL_AUTHORIZED=false`; `NV03_SELF_PULL_ACTIVE=false`.
- #4649 — mở tính năng tự nhận P1–P5: đóng `not_planned`. #4653 — canary claim/lease: đóng `not_planned`.
- PR #4660 — nền tảng lease dùng chung Core/NV03: đóng, **chưa merge**, không dùng làm nguồn triển khai.
- NV03 = ChatGPT Go QA/Reviewer độc lập; có thể chủ động rà soát PR GitHub đúng HEAD, kiểm tra diff/CI/test và ghi bằng chứng không trùng. **Không được tự nhận Work Order P1–P5, tự viết mã hoặc tự phê duyệt.**
- Core không giao/điều khiển NV03. App Chrome LOCAL_ONLY duy trì phiên và nhắc NV03 tiếp tục QA, không phải bộ điều phối hoặc bộ giữ lease.
- Không yêu cầu tài khoản GitHub khác, dịch vụ giữ lease Core hoặc kết nối NV03 → Core cho QA.
- Những thay đổi source/runtime có thể đã chuẩn bị cho chế độ tự nhận phải **giữ khóa, không bật và không phát hành như tính năng**. Muốn khôi phục phải có quyết định Owner mới cùng kiểm thử và nghiệm thu tương ứng.
- Không ảnh hưởng NV02 tự nhận việc hoặc NV04 được Core phân công theo phạm vi hiện hữu.

Nguồn: `bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md` và `bootstrap/02_TIGERIQ_WORKFLOW.md` sau khi PR chính sách được hợp nhất.
