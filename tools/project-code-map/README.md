# TigerIQ Project Code Map — phiên bản dùng được qua dòng lệnh

Yêu cầu Node.js >= 20. Không cần cài thêm gói cho công cụ.

Chạy trực tiếp trong repository:

```bash
npm run code-map -- --root . --output code-map.json --html code-map.html
```

Hoặc xuất kết quả ra dòng lệnh:

```bash
node tools/project-code-map/cli.mjs --root .
```

Kết quả JSON chứa `schemaVersion`, `sourceRevision` (nếu truyền biến `TIGERIQ_SOURCE_SHA`), `summary.sourceFiles`, `summary.dependencyEdges`, `nodes` và `edges` (`from` đường dẫn mã nguồn tương đối, `to` tên module hoặc đường dẫn import). Không xuất nội dung mã nguồn, không phụ thuộc PC01, khóa bí mật hoặc API trả phí.

Công cụ nhận diện import tĩnh, `import('literal')` động, tái xuất `export ... from` và CommonJS `require('literal')`; không tự giải quyết đường dẫn tới tệp đích, không tuyên bố hỗ trợ JavaScript/TypeScript syntax toàn phần hoặc import động có biến. Bỏ qua thư mục phụ thuộc và mã sinh phổ biến.

GitHub Actions: `.github/workflows/project-code-map-live.yml` chạy trên mã nguồn thật ở mỗi PR và lần hợp nhất liên quan, rồi xuất `tigeriq-code-map.json` thành gói tải về `TigerIQ-Code-Map-<SHA>`. Phải kiểm tra kết quả job và tệp thật trước khi coi bước nghiệm thu hoàn tất.

Kiểm thử offline:

```bash
node --test tests/project-code-map-cli.test.mjs
```

## Xem sơ đồ trực quan offline

Mở `code-map.html` bằng Chrome/Edge: tìm kiếm theo tên tệp, bật lọc tệp có import, chạm tên tệp để xem import đi/đến. Phần mềm không cần máy chủ, CDN, token hay kết nối Internet; HTML chứa sơ đồ dưới dạng dữ liệu JSON inert đã escape, không chứa mã nguồn thực tế. Bấm tên module nội bộ để đi tiếp.

Bộ kiểm thử UI có trong `tests/e2e/project-code-map-offline.spec.ts`, chạy bằng `npm run test:e2e` (Chrome). GitHub Actions xuất cả `tigeriq-code-map.json` lẫn `tigeriq-code-map.html` từ cùng một revision thực; giải nén và mở HTML trực tiếp.

Đây là bản đồ module dựa trên biểu thức import có tên cố định, không phải trình phân tích phụ thuộc toàn diện. Đường dẫn import khác thường, alias TypeScript và dynamic import dùng biến có thể không phân giải được; UI phân biệt rõ module nội bộ và module ngoài/chưa phân giải.
