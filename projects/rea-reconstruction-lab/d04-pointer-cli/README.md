# D04 — CLI tái tạo JSONPointer độc lập v0.6.1

Nguồn công việc: [REA #4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780). Đây là phần mềm **viết mới**, không phải `rea-agents@6.4.0`, không phải phát hành PC01/MCP. Tác vụ D03 chạy REA gốc trên máy GitHub cô lập đã có biên nhận riêng; PR này **không chạy lại** D03.

Nguồn đối chiếu: [janl/node-jsonpointer](https://github.com/janl/node-jsonpointer), MIT, commit `4a253c0d8f0d4d7f4c01f566bf8bf16f775dcdca`, mã nguồn Git blob `dad907d763f7369ac0e284e7d1fae2bd5508f477`. Mã nguồn và giấy phép nguyên bản đã được ghim trước trong `../d02-node-jsonpointer/`; **không được gán tag Git v5.0.1 thành bytes npm 5.0.1**.

Từ gốc kho:

```sh
node projects/rea-reconstruction-lab/d04-pointer-cli/bin/rea-pointer-demo.mjs --help
printf '%s\n' '{"id":"example","op":"get","document":{"a":{"b":7}},"pointer":"/a/b"}' | node projects/rea-reconstruction-lab/d04-pointer-cli/bin/rea-pointer-demo.mjs --jsonl
npm pack --offline --ignore-scripts --pack-destination /tmp projects/rea-reconstruction-lab/d04-pointer-cli
```

Phạm vi: hỗ trợ `get` và `set` của JSON Pointer với JSONL. Giới hạn mỗi dòng 32 KiB, tổng 1 MiB, tối đa 1000 dòng, mảng không quá 4096 phần tử, đầu vào UTF-8 hợp lệ; chỉ nhận cấu trúc JSON thường, không thực thi getter, từ chối truy cập prototype, vòng tham chiếu, prototype khác, kích thước/độ sâu không hợp lệ. Bản v0.6.0 bổ sung thao tác JSONL `compile-get` và `compile-set`: biên dịch đường dẫn một lần, gọi các hàm JavaScript được ràng buộc để đọc/ghi trên cùng bản sao JSON. Đây là cách thể hiện có giới hạn của `compile` gốc: không tuần tự hóa closure/function thành JSON, không thay thế đầy đủ API gốc. 10 ca mới đối chiếu hành vi closure của MIT với bản mới và tiến trình CLI nằm ở `tests/rea-reconstruction-lab/r09-jsonpointer-compile-runtime.test.ts`.

Bản vá v0.6.1 không cho phép xóa ô mảng bằng giá trị `undefined` (kể cả đầu vào JSONL bỏ trường `value`): thao tác đó tạo **mảng thưa**, sau khi tuần tự hóa JSON bị chuyển thành `null` và mất ngữ nghĩa. Giờ từ chối sớm với `Sparse array deletion forbidden.` và bảo toàn tài liệu gốc. Đây là **ngoại lệ an toàn có chủ ý** so với thư viện MIT, không tính là tương đương; việc xóa khóa thuộc tính đối tượng vẫn được hỗ trợ. Bộ thử mới nằm ở `tests/rea-reconstruction-lab/r09-jsonpointer-array-delete-integrity.test.ts`.

API JS không bảo vệ chống mọi bẫy `Proxy` của mã độc chạy cùng tiến trình. Một số trường hợp cố ý từ chối dù thư viện MIT nguồn cho phép, nên **không phải bản thay thế tương đương toàn bộ API**.

Kiểm thử mã nguồn tại `tests/rea-reconstruction-lab/d04-pointer-cli.test.ts` kiểm tra 10 ca vàng gốc, CLI chạy thật, hồi quy bảo mật. Nghiệm thu PC01, Core lease, REA MCP và Work Order 6/16 là các cổng riêng, không suy ra từ CI hoặc gói npm.
