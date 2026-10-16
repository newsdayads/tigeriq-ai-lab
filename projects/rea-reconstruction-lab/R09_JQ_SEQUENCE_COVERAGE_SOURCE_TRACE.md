# REA R09 — jq JSON Sequence: kiểm tra mất bản ghi khi mã thoát vẫn bằng 0

Work Order: https://github.com/newsdayads/tigeriq-ai-lab/issues/4780  
Scope: `TIGERIQ_REA_RECONSTRUCTION_LAB_V1`  
Status: `R09_SOURCE_ONLY_PARTIAL_TRACE`, **not** REA runtime acceptance or R05/R06 authorization.

## Vấn đề thực tế

Bộ kiểm tra nguồn R09 hiện hành ghi được 16 quan sát CLI thực của `/usr/bin/jq --version=jq-1.7` với SHA256 nhị phân `5e1dcc8c21b9362013a1f30acb24c69a128cbd5238364b88803f4c60cd9376dd`. Nguồn upstream jq 1.7 được cố định tại commit `11c528d04d76c9b9553781aa76b073e4f40da008`, **không có chứng cứ build bản nhị phân này từ commit đó**. Các đầu vào chỉ chứa JSON tổng hợp, không dữ liệu riêng của Owner.

Bốn quan sát lệnh `jq --seq -c .` đều trả `exitCode=0`:

| ID kiểm thử đã khóa SHA | Khung đầu vào RS | Khung đầu ra RS | `stderr` | Kết luận bảo thủ |
|---|---:|---:|---|---|
| `B07_JSON_SEQ_RESYNC` | 3 | 2 | rỗng | **Thiếu 1 bản ghi mà không cảnh báo** |
| `B13_SEQ_ERROR` | 3 | 3 | rỗng | Đếm đủ nhưng ký hiệu không chuẩn `NaN` được chuẩn hóa thành `null` |
| `B15_SEQ_INVALID_TOKEN` | 3 | 2 | có cảnh báo parser | **Thiếu 1 bản ghi** dù mã thoát 0 |
| `B16_SEQ_MALFORMED_BRACE` | 3 | 2 | có cảnh báo parser | **Thiếu 1 bản ghi** dù mã thoát 0 |

Bản mô hình mới **không chạy lại jq**, không đọc các stream bí mật, chỉ lấy bốn case thực trong `r09-jq-observation-16.zlib.b64` sau khi `inspectR09Snapshot` xác minh tính toàn vẹn manifest và stream SHA. Số `0x1e` (RS) được đếm độc lập trong bytes đầu vào/đầu ra. Đầu ra chỉ là thống kê số khung, cờ cảnh báo và nhóm rủi ro; không kết luận các khung có số lượng bằng nhau là tương đương nội dung hay đã khôi phục mọi bản ghi.

## Liên kết chứng cứ nguồn jq bất biến (chỉ giải thích ở cấp source)

- [`src/main.c` tại commit ghim](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/main.c), Git blob `9c6b3cf75af38ac986faa1f4527301ed0228231e`: đoạn 719–725 kích hoạt `JV_PARSE_SEQ`; 740–765 phân biệt lỗi parse thường (fatal) với `--seq` (ghi cảnh báo rồi tiếp tục), đoạn 786–797 quyết định mã thoát.
- [`src/jv_parse.c` tại cùng commit](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/jv_parse.c), Git blob `62f0e1d87241c4ddf9430b691a5062d765da2598`: đoạn 785–811 đặt trạng thái chờ ký tự `RS` khi cần đồng bộ lại.
- [`src/jv_print.c` tại cùng commit](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/jv_print.c), Git blob `372367067667d5e7d0059144c65bddc79c91a5cc`: đoạn 225–240 xử lý số `NaN` thành JSON `null` ở đầu ra.

Đây là **liên kết mã nguồn với quan sát hành vi**, không phải trace hàm ở runtime, không có REA thật tham gia.

## Tiêu chí thử hồi quy

File kiểm tra `tests/rea-reconstruction-lab/r09-jq-sequence-coverage.test.ts` yêu cầu chứng cứ ghim SHA hợp lệ trước khi phân loại. Bộ thử tách riêng mất khung im lặng, mất khung có cảnh báo, phép chuẩn hóa `NaN`, kiểm tra sửa dữ liệu/mã thoát hoặc khai khống đã chạy REA/PC01, và chắc chắn không biến phân tích nguồn thành PASS của R09.

`completeInputSemanticsVerified=false`, `reaExecuted=false`, `r09Accepted=false`, `coreLeaseOwned=false`, `installAuthorized=false`, `mutated=false` phải được giữ nguyên.

**Phụ thuộc còn thiếu:** R05 danh tính NV02 và biên nhận lease nguyên tử đúng phạm vi; R06 consumer-resolved lock/SBOM thật cùng cách ly host; R07/MCP chạy thật và R09 phân tích do chính REA thực hiện. Không cài đặt PC01, không chi phí, không thay đổi production.
