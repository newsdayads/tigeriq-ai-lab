# G1 — Tiền kiểm 5 lượt R/USB tại chỗ, không phải nghiệm thu thiết bị (20/10/2026)

**Work Order:** [GH-4625](https://github.com/newsdayads/tigeriq-ai-lab/issues/4625) | **Scope:** `DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD`

- **Đích thực tế:** nhận 5 lượt R/USB **đã quan sát trên Samsung/DeX thật, xe đỗ an toàn**, phân biệt USB attach, quyền USB, frame sống nhìn thấy và tín hiệu R độc lập. Nguồn các trường chi tiết vẫn là [03_CAMERA_DIAGNOSTICS.md](03_CAMERA_DIAGNOSTICS.md).
- **Công cụ:** [g1-cycle-admission.mjs](g1-cycle-admission.mjs), hàm `inspectG1Cycles(record)`. Chỉ nhận object JavaScript có `schema:'dexcam-g1-cycles-v1'`, `capture_kind`, `redaction_confirmed`, `cycles` gồm ít nhất 5 bản ghi. Các khóa cần có theo kiểm tra nguồn; có thể chuyển từng hàng CSV nguồn sang object **trên máy cục bộ riêng tư**. Hàm không mở tệp, không gọi USB, không điều khiển xe, không gửi mạng, không in dữ liệu người dùng.
- Mỗi `cycle_id` phải riêng, ghi USB VID/PID và interface class **đọc thật**; USB trước/trong R, hai dấu mốc bật/tắt R và hai pointer `LOCAL_ONLY:` khác nhau, nguồn đồng hồ, kết quả tự mở và lần mở thủ công nếu lỗi tự nhiên; một lượt thành công chỉ ghi khi có mốc *first visible live frame* quan sát.
- Khác đồng hồ R và Android: **không tính latency** nếu thiếu đồng bộ/offset/sai số. Bộ tiền kiểm này không tính latency hoặc xác thực file log; pointer hợp lệ **không chứng minh** đã quan sát, không tự khẳng định R đã OFF, và không được dùng để tự động chuyển G1.
- Output: `INCOMPLETE`, `SYNTHETIC_FIXTURE_ONLY` hoặc `CANDIDATE_NEEDS_DEVICE_REVIEW`. Luôn `g1_accepted:false`. Cần đối chiếu ảnh/log/descriptor và an toàn vật lý trước mọi nghiệm thu.
- Bảo mật: log, ảnh, VID/PID thiết bị chủ xe, thời gian và dữ liệu cá nhân lưu tại thiết bị; **không đẩy bản gốc lên GitHub công khai**. Chỉ mã nguồn, hướng dẫn và fixture tổng hợp được phép nằm trong repo.
- Kiểm thử nguồn (không phải xe thật): `npx vitest run tests/dexcam-personal/g1-cycle-admission.test.ts`. G1/G2/D01 và P01 REA vẫn chưa đạt. Nguồn điều hành và checklist: Issue #4625, 13/30 không đổi.

**Khi có quyền thu thật:** quan sát 5 chu kỳ xe dừng an toàn theo [03_CAMERA_DIAGNOSTICS.md](03_CAMERA_DIAGNOSTICS.md), không sửa dây điện, không thay quyền camera, không cài APK, không dùng RDC/PC01; kiểm tra dữ liệu offline tại môi trường được cho phép, sau đó rà provenance và mới đề xuất nghiệm thu.


## Lệnh tiền kiểm JSON tại máy được phép

Sau khi đã có **5 lượt quan sát thực**, được thu thập khi xe đỗ an toàn và có quyền trên máy sử dụng, lưu dữ liệu thành JSON cục bộ theo các trường trong `g1-cycle-admission.mjs`. Chạy ngoại tuyến:

```bash
node projects/dexcam-personal/g1-local-preflight.mjs /duong-dan-rieng/nam-luot-r.json
```

- Công cụ **chỉ đọc** một tệp JSON thường tối đa 64 KiB, dùng lại bộ đọc an toàn của B01, từ chối symlink trên POSIX, ống FIFO/thư mục và tệp quá lớn. Kiểm tra metadata và file handle nhưng không bảo đảm loại bỏ mọi cuộc đua tên đường dẫn trên Windows.
- Chỉ xuất `status`, `g1_accepted:false`, danh sách **mã lỗi trường đã lọc**, `next`. Không xuất nội dung JSON, tên/đường dẫn tệp, pointer log hoặc số liệu riêng tư.
- Exit `0` chỉ nghĩa là **đủ cấu trúc để xem xét** (kể cả bản giả lập), **không phải** năm lượt đã thực hiện hoặc G1 được nghiệm thu; exit `1` là thiếu/sai dữ liệu, exit `2` là cú pháp lệnh không hợp lệ.
- `REAL_DEVICE_OBSERVATION` chỉ trả `CANDIDATE_NEEDS_DEVICE_REVIEW`. Muốn nghiệm thu G1 phải đối chiếu riêng 5 log/ảnh/descriptor thực tế, tín hiệu R độc lập và điều kiện an toàn; sau đó mới xét G2.
- Unit regression: `npx vitest run tests/dexcam-personal/g1-local-preflight.test.ts`. Không được tự chạy trên PC01, RDC hoặc thiết bị xe khi cổng Work Order chưa cho phép. **Không đẩy file JSON thực lên GitHub/CI.**

