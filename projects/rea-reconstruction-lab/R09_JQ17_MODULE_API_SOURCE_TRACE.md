# GH-4780 — R09 jq 1.7: truy vết module/API bằng nguồn và quan sát native

**Phân loại:** `PARTIAL_R09_SOURCE_AND_ACTUAL_LOCAL_JQ_OBSERVATION`. **KHÔNG PHẢI** REA MCP chạy thật, module map do REA tạo, build jq từ commit upstream, hay nghiệm thu R09/R05–R07. Work Order [#4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780) giữ `6/16 | DONE=false`.

**Đối tượng đã cố định:** jq 1.7 public repository `jqlang/jq`, commit [`11c528d04d76c9b9553781aa76b073e4f40da008`](https://github.com/jqlang/jq/commit/11c528d04d76c9b9553781aa76b073e4f40da008) (mẫu R08 hợp pháp). Source source commit được đọc trực tiếp qua GitHub; Git blob từng tệp ghi dưới đây. Không đưa mã upstream vào repo TigerIQ.

## 1. Bản đồ luồng thực thi có chứng cứ nguồn

| Lớp | Mã nguồn cố định + Git blob | Ranh giới API/hành vi quan sát từ nguồn |
|---|---|---|
| CLI | [`src/main.c:197–245`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/main.c#L197-L245) — `9c6b3cf75af38ac986faa1f4527301ed0228231e` | `process()` gọi `jq_start`, lặp `jq_next`, ghi stdout và cập nhật trạng thái trả về. |
| JSON input | [`src/jv_parse.c:708–785`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/jv_parse.c#L708-L785) — `62f0e1d87241c4ddf9430b691a5062d765da2598` | `jv_parser_new/next` tạo lần lượt giá trị JSON; cần phân biệt parse error với kết quả filter. |
| Lex / Grammar | [`src/lexer.l`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/lexer.l) — `d29de81f352ea2e638075bd6cc5ada092b1425f9`; [`src/parser.y`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/parser.y) — `3d246895526227d98f427d1bbf64a8e2007a4f23` | Chuỗi filter qua tokenizer và parser (`jq_parse`, `gen_index`, `gen_binop`), không xử lý chuỗi filter như JSON literal. |
| Compiler + modules | [`src/compile.c:1371`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/compile.c#L1371) — `76d4bcbce6b098ac046db79b55d7dd61e271e613`; [`src/linker.c:409–435`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/linker.c#L409-L435) — `e7d1024c1d7d48370465684159559899dc4d4aa0` | `block_compile`, `load_program` biên dịch/lắp phụ thuộc; `load_program` có logic thư viện `~/.jq`, nên đường nhập module là ranh giới phải kiểm soát riêng, **chưa thử nghiệm**. |
| VM filter | [`src/execute.c:1114–1130`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/execute.c#L1114-L1130) — `02af823214c70fb79ab83a9eee638ba7489db942` | `jq_start` khởi tạo frame/stack; `jq_next` thực thi VM. Không phải mỗi filter chỉ phát một giá trị. |
| Giá trị, path | [`src/jv.h`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/jv.h) — `eb313f8a97a62e13b164d7614e18d72eb828a1a3`; [`src/jv_aux.c:79–239`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/jv_aux.c#L79-L239) — `0b7d169df504ec627e7ce2790b6112bb9ddb1694` | `jv` là cây giá trị JSON, `jv_get/set/has` phân biệt object, array, scalar, null; cập nhật path sai loại dẫn tới lỗi runtime. |
| Hàm dựng sẵn | [`src/builtin.c`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/builtin.c) — `2ea40dc54fbe99f5241f476b6f60f65dc4276632`; [`src/builtin.jq:3–41,248–256`](https://github.com/jqlang/jq/blob/11c528d04d76c9b9553781aa76b073e4f40da008/src/builtin.jq#L3-L41) — `1e23a2ed66ea1643a8366c9d45890ea9015669ec` | `map`, `sort_by`, `to_entries/from_entries`, `walk` là tổ hợp định nghĩa jq; `getpath/setpath/delpaths` có lõi hỗ trợ ở C. |

**Luồng tổng quát theo nguồn:** `stdin → jv_parser → lexer/parser → compile/link → jq_start/jq_next → jv_get/jv_set + builtin → stdout/exit`. Đây là sơ đồ giải thích tĩnh do NV02 dựng từ mã nguồn; **chưa có call-graph động được REA sinh ra**.

## 2. Quan sát hành vi thực tế mới, không lặp lại R09 CLI exit/stream

Thiết bị đo: `/usr/bin/jq --version = jq-1.7` trong container Linux cô lập. **SHA256 binary** `5e1dcc8c21b9362013a1f30acb24c69a128cbd5238364b88803f4c60cd9376dd`. Quan sát 10/10 trường hợp dùng JSON tổng hợp, `subprocess` 4 giây/ca, không gọi mạng hoặc PC01. Binary runtime không có bằng chứng build từ commit upstream cố định. Dữ liệu xác minh byte của từng trường hợp nằm trong [`r09-jq-module-api-native-oracle.mjs`](./r09-jq-module-api-native-oracle.mjs), fixture SHA256 `ed74855b4d4b0fd509cec36efa7cb7a3ee654438218d0c56da59d746110a7fb4`.

| ID | Ranh giới kiểm chứng jq-1.7 | Quan sát thực tế / ý nghĩa cho thiết kế sạch |
|---|---|---|
| M01 | `map` + giá trị `//` mặc định | `[3,1,1]`, phân biệt null/thiếu thuộc tính với số hợp lệ. |
| M02 | `sort_by` nhiều khóa | `["a","b","c"]`, giữ thứ tự khóa `priority,id`. |
| M03 | `getpath` object/array lồng nhau | Kết quả `7`; path gồm chuỗi và chỉ số nguyên. |
| M04 | `setpath` thay giá trị lồng nhau | `{"items":[{"v":99},{"v":2}]}`, giữ phần tử khác. |
| M05 | `delpaths` tại object và array | Thu được `{"meta":{"public":1},"items":["b"]}`, array được thu ngắn. |
| M06 | `walk` trên các mức lồng nhau | `{"a":[2,{"b":6}],"c":"ok"}`, giữ nguyên chuỗi. |
| M07 | `reduce` cộng dồn theo khóa | `{"a":5,"b":4}`, gom nhiều hàng có khóa trùng. |
| M08 | `try/catch` với `tonumber` lỗi | Phát `"BAD"`, mã thoát 0; lỗi bị chuyển thành dữ liệu theo filter. |
| M09 | `to_entries/from_entries` | Lọc `b=-1` rồi phục hồi `{"a":1,"c":2}`. |
| M10 | `setpath` index sai loại | Mã thoát **5**, stdout rỗng, stderr `Cannot index array with string "a"`. |

Khác hẳn báo cáo R09 hiện có [exit/stream](./R09_JQ_EXIT_STREAM_NATIVE_SOURCE_TRACE.md): đợt này tập trung **hàm, dữ liệu, cập nhật đường dẫn, lỗi kiểu**. Không dùng lại 13 fixture X01–X13 hay coi các phép thử này là REA hoạt động.

## 3. Cách chạy lại và giới hạn an toàn

```bash
node projects/rea-reconstruction-lab/r09-jq-module-api-native-oracle.mjs --replay-isolated
```

Runner chỉ nhận `/usr/bin/jq` có **đúng SHA256** và `jq-1.7`; chạy 10 lệnh với input được pin, so sánh **stdout/stderr/exit bytes**, mỗi lượt 3 giây; nếu mismatch báo mã lỗi, không che thành PASS. Không cài package, không lệnh shell động, không dùng credential, API, PC01, RDC hoặc App Chrome. CI Vitest chỉ kiểm tra **tính toàn vẹn oracle**; không gọi binary native ngầm.

## 4. Điều kiện còn thiếu trước nghiệm thu R09

- Chưa có công cụ REA runtime/MCP tạo bản đồ module, API hoặc trace trên sample jq 1.7 đã cấp phép; sơ đồ ở trên là **đối chiếu tĩnh riêng**.
- Chưa có provenance build binary từ chính upstream SHA; không chuyển quan sát binary hiện hữu thành bằng chứng source build.
- R05 chưa có nhân sự NV02 được nhận diện/ủy quyền host và lease nguyên tử; R06 thiếu consumer-resolved lock/SBOM và cô lập VM; R07 chưa có kết nối REA thật.
- **Không tích ô R09, không chuyển DONE và không hợp nhất kết quả giả.** Báo cáo này là mảnh ghép chứng cứ thực tế mới, có thể dùng khi cổng R05–R07 mở hợp lệ.
