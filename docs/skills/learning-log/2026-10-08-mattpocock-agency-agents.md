# Đối chiếu Matt Pocock Skills + The Agency — 2026-10-08

Nguồn công việc: #4578 - [P2][SKILLS][TÍCH HỢP] Chọn lọc Matt Pocock Skills + The Agency, loại trùng và nâng chuẩn kỹ thuật
Kiến trúc kế thừa: [Skill Registry](../registry.yaml), [Skill System](../README.md); chương trình trước `#4377` đến `#4382`, sổ học `#859`, bộ kiểm soát nguồn ngoài `#909`.

## 1. Nguồn và điều kiện sử dụng

- Nội dung gửi trong cuộc trò chuyện: `v1c044g50000db32rfvog65o4dlbghqg.mp4` (Matt Pocock Skills) và `v14025g50000db33hnvog65lulkdqdrg.mp4` (The Agency). Không chép video vào repository. Mã băm gốc: NOT_CAPTURED.
- Matt Pocock Skills: https://github.com/mattpocock/skills tại commit `b0618bc436ad893b3c5e84e55fba86586d34a404`; giấy phép MIT, 2026 Matt Pocock.
- The Agency: https://github.com/msitarzewski/agency-agents tại commit `f99f6aa910a442b0197b768ce0ea7751e35e2060`; giấy phép MIT, 2025 AgentLand Contributors.
- Đã kiểm tra tệp LICENSE và các tài liệu dưới đây tại commit nguồn. Không cài bộ cài ngoài, không sao chép nguyên tệp/prompt bên thứ ba, không chạy tập lệnh hay chép nội dung cần giấy phép; chỉ diễn giải nguyên tắc và ghi nguồn.
- Nguyên tắc ưu tiên: nguồn quy định TigerIQ trên `main` > ví dụ/hướng dẫn bên ngoài. Các mô hình/nhân vật mô tả trong The Agency không được xem là nhân sự thực đang chạy.

## 2. Ma trận TRÙNG / CẢI TIẾN / LOẠI

| Kho ngoài / tệp đã đọc | Năng lực TigerIQ đã có | Phần mới có ích | Xử lý |
| --- | --- | --- | --- |
| Matt `skills/engineering/tdd/SKILL.md` | ACTIVE `spec-first-tdd`: SPEC/RED/GREEN, exact-head | Thử theo giao diện công khai, kiểm thử theo lát cắt; là hướng dẫn, chưa có dữ liệu cho việc bắt buộc mọi nơi | **GIỮ**, không nhập skill trùng |
| Matt `skills/engineering/diagnosing-bugs/SKILL.md` | `spec-first-tdd`, `learn-from-failure` và vòng RCA Core | Vòng tái hiện chính xác triệu chứng, tối thiểu hóa trường hợp lỗi, kiểm tra giả thuyết có thể bác bỏ, xác minh quy trình gốc | **CẢI TIẾN** `spec-first-tdd` 1.1.0 |
| Matt `skills/engineering/code-review/SKILL.md` | ACTIVE `automated-code-review-gate`, vai trò tách biệt | Đánh giá hai trục: đúng yêu cầu và đúng chuẩn repository, phân biệt lỗi chặn phát hành với góp ý | **CẢI TIẾN** `automated-code-review-gate` 1.1.0 |
| Matt `skills/engineering/improve-codebase-architecture/SKILL.md` | ADR, quản trị kiến trúc, kiểm toán mã nguồn, `minimal-change-output` | Gợi ý chiều sâu mô-đun, bề mặt kiểm thử; chưa có trường hợp đo lợi ích riêng | **THAM KHẢO**, chưa thêm skill hay tạo báo cáo HTML tự động |
| Matt `skills/engineering/grill-with-docs/SKILL.md` | SPEC-First và lệnh Owner rõ mục tiêu | Phỏng vấn sâu hữu ích khi thật sự thiếu ràng buộc | **LOẠI mặc định** vòng hỏi lặp vì xung đột Owner NO YAPPING |
| Agency `engineering/engineering-multi-agent-systems-architect.md` | Core, Registry, `role-separated-execution`, `isolated-parallel-execution` | Các khái niệm idempotency/failover/quan sát đã hiện hữu ở Core | **KHÔNG** lập kiến trúc sư, bộ định tuyến hoặc worker thứ hai |
| Agency `engineering/engineering-minimal-change-engineer.md` | ACTIVE `minimal-change-output` + destructive-write guard | Mẫu tự kiểm tra độ rộng diff | **KHÔNG** tạo role/skill trùng |
| Agency `testing/testing-evidence-collector.md` | ACTIVE `visual-quality-gate`, `automated-code-review-gate`; CANDIDATE `community-software-qa` | Phân biệt ảnh chứng minh giao diện với assertion/receipt chứng minh hành vi | **CẢI TIẾN** cổng review hiện tại |
| Agency `testing/testing-reality-checker.md` | Cổng xác minh evidence/TIGERIQ, reviewer độc lập | Bảng mỗi lời khẳng định ↔ bằng chứng; nêu phần chưa thử | **CẢI TIẾN** cổng review, loại tiêu chí 'mặc định không đạt' không dựa evidence |
| Agency `engineering/engineering-incident-response-commander.md` | Core failure recovery, lease/failover, operations domain pack | Phân loại mức sự cố, timeline, postmortem có thể hữu ích khi có dữ liệu thực | **CHƯA THÊM**, chỉ đánh giá ở công việc sự cố thật |

## 3. Phần điều chỉnh cho TigerIQ

1. **Mã nguồn / lỗi:** Tại `spec-first-tdd` ACTIVE, yêu cầu tái hiện lỗi với điều kiện dương/âm cụ thể khi có thể; lưu lệnh/đầu ra, rút gọn kịch bản và thử giả thuyết. Không ép tạo RED giả cho việc tài liệu/config.
2. **Rà soát:** Tại `automated-code-review-gate` ACTIVE, tách hai trục `SPEC` / `STANDARDS`, lập bảng yêu cầu ↔ bằng chứng và nêu phạm vi chưa được thử. Ảnh không chứng minh dữ liệu được lưu hoặc thao tác có hiệu lực; bằng chứng có thể là kiểm thử, bản ghi hoặc kết quả thực.
3. **Nhân sự:** Không sửa danh bạ AI, không lập thêm review agent, không nhân bản NV03/NV04. Vai trò trong The Agency là tài liệu tham chiếu cho nhân sự hiện hữu.
4. **Trạng thái:** Giữ nguyên 17 ID hiện có (16 ACTIVE, 1 CANDIDATE) và trạng thái; chỉ tăng phiên bản 2 kỹ năng ACTIVE `1.0.0 → 1.1.0`. Không khai rằng phiên bản mới đã được kiểm chứng trên máy thật chỉ bởi thay đổi tài liệu.
5. **Ranh giới:** Không dùng Codex, Remote Desktop Commander, cài đặt bên ngoài, đổi quyền, chạy Production, sửa App Chrome, cấu hình bảo mật hay tạo bộ điều phối riêng.

## 4. Nghiệm thu và chống nâng cấp ảo

- **Nguồn:** ghi cụ thể commit upstream và giấy phép; không sử dụng `latest` trôi nổi.
- **Cấu trúc:** registry vẫn duy nhất; ID không tăng, phiên bản registry khớp SKILL.md. Đối chiếu bằng kiểm tra mã nguồn/tệp trên cùng revision.
- **Chất lượng:** áp dụng hai kỹ thuật mới trên một lỗi và một thay đổi PR thật có bằng chứng; không tự khai PASS chỉ từ văn bản.
- **Luồng chuẩn:** nhánh riêng → PR → kiểm thử đúng mã → reviewer độc lập → nhập `main` có điều kiện → đọc lại `main`; xác minh lúc vận hành nếu thay đổi hành vi.
- **Không trùng:** không thêm bộ công cụ, nhân sự, Registry, scheduler/router hoặc skill ID mới.
- **Còn thiếu:** trước khi có kiểm thử và rà soát độc lập, đây là thay đổi đề xuất, chưa đủ bằng chứng để báo triển khai thành công.

## 5. Giữ gì / loại gì

**GIỮ:** vòng kiểm chứng lỗi chặt chẽ; hai trục review; bảng bằng chứng theo tuyên bố; các ranh giới nhiệm vụ và quyền hiện hữu.

**LOẠI:** cài `npx skills@latest` hoặc ứng dụng Agency Agents; nạp toàn bộ vai trò; đề nghị Owner phỏng vấn lặp; người rà soát tự phê duyệt; ngầm định FAIL dù có bằng chứng đủ; yêu cầu ảnh màn hình cho tất cả loại công việc; báo DONE nếu chưa đủ bằng chứng.

**Theo dõi:** đo tỷ lệ lỗi được tái hiện thật, lỗi tái xuất hiện, thiếu bằng chứng và thời gian xử lý trong các công việc tiếp theo. Chưa có số liệu thực nên không công bố phần trăm cải thiện.
