# D04 — CLI tái tạo JSONPointer độc lập v0.5.0

Nguồn công việc: [REA #4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780). Đây là phần mềm **viết mới**, không phải `rea-agents@6.4.0`, không phải phát hành PC01/MCP. Tác vụ D03 chạy REA gốc trên máy GitHub cô lập đã có biên nhận riêng; PR này **không chạy lại** D03.

Nguồn đối chiếu: [janl/node-jsonpointer](https://github.com/janl/node-jsonpointer), MIT, commit `4a253c0d8f0d4d7f4c01f566bf8bf16f775dcdca`, mã nguồn Git blob `dad907d763f7369ac0e284e7d1fae2bd5508f477`. Mã nguồn và giấy phép nguyên bản đã được ghim trước trong `../d02-node-jsonpointer/`; **không được gán tag Git v5.0.1 thành bytes npm 5.0.1**.

Từ gốc kho:

```sh
node projects/rea-reconstruction-lab/d04-pointer-cli/bin/rea-pointer-demo.mjs --help
printf '%s\n' '{"id":"example","op":"get","document":{"a":{"b":7}},"pointer":"/a/b"}' | node projects/rea-reconstruction-lab/d04-pointer-cli/bin/rea-pointer-demo.mjs --jsonl
npm pack --offline --ignore-scripts --pack-destination /tmp projects/rea-reconstruction-lab/d04-pointer-cli
```

Phạm vi: hỗ trợ `get` và `set` của JSON Pointer với JSONL. Giới hạn mỗi dòng 32 KiB, tổng 1 MiB, tối đa 1000 dòng, mảng không quá 4096 phần tử, đầu vào UTF-8 hợp lệ; chỉ nhận cấu trúc JSON thường, không thực thi getter, từ chối truy cập prototype, vòng tham chiếu, prototype khác, kích thước/độ sâu không hợp lệ. API JS không bảo vệ chống mọi bẫy `Proxy` của mã độc chạy cùng tiến trình. Một số trường hợp cố ý từ chối dù thư viện MIT nguồn cho phép, nên **không phải bản thay thế tương đương toàn bộ API**.

Kiểm thử mã nguồn tại `tests/rea-reconstruction-lab/d04-pointer-cli.test.ts` kiểm tra 10 ca vàng gốc, CLI chạy thật, hồi quy bảo mật. Nghiệm thu PC01, Core lease, REA MCP và Work Order 6/16 là các cổng riêng, không suy ra từ CI hoặc gói npm.
