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


## Truy vấn module chọn lọc (không đọc lại toàn bộ bản đồ)

Khi biết chính xác đường dẫn module tương đối từ root, chỉ lấy các import trực tiếp và các tệp nhập module đó:

```bash
TIGERIQ_SOURCE_SHA=<40-hex-commit-sha> node tools/project-code-map/cli.mjs \
  --root . --query tools/project-code-map/cli.mjs \
  --expect-sha <40-hex-commit-sha> \
  --output code-map-query.json
```

Kết quả JSON: `sourceRef`, `sourceRevision`, `revisionChecked`, `outgoing` (specifier + resolvedTarget nếu phân giải được), `incoming` (đường dẫn tệp nguồn + specifier). Không chứa mã nguồn hoặc toàn bộ graph. Đường dẫn query phải khớp **chính xác** một node trong map. Alias/biến, import ngoài repo và đường dẫn vượt root **không** bị suy diễn thành liên kết nội bộ.

`--expect-sha` bắt buộc định dạng SHA 40 ký tự và từ chối khi SHA mong đợi khác metadata `TIGERIQ_SOURCE_SHA` (hoặc metadata thiếu). Đây là phép kiểm tra revision do nguồn/build cung cấp, **không thay thế** xác minh Git checkout thực tế. GitHub Actions kiểm tra SHA checkout trước khi tạo bản đồ. Nếu không truyền `--expect-sha`, kết quả có `revisionChecked=false`, không tuyên bố map còn mới.

GitHub workflow đo `full_bytes` và `query_bytes` cho module CLI trên chính repository, xuất thêm `tigeriq-code-map-query.json` bên cạnh JSON/HTML. Đây là truy vấn một-hop, không phải graph database, không thay thế GitHub main.

## Xem sơ đồ trực quan offline

Mở `code-map.html` bằng Chrome/Edge: tìm kiếm theo tên tệp, bật lọc tệp có import, chạm tên tệp để xem import đi/đến. Phần mềm không cần máy chủ, CDN, token hay kết nối Internet; HTML chứa sơ đồ dưới dạng dữ liệu JSON inert đã escape, không chứa mã nguồn thực tế. Bấm tên module nội bộ để đi tiếp.

Bộ kiểm thử UI có trong `tests/e2e/project-code-map-offline.spec.ts`, chạy bằng `npm run test:e2e` (Chrome). GitHub Actions xuất cả `tigeriq-code-map.json` lẫn `tigeriq-code-map.html` từ cùng một revision thực; giải nén và mở HTML trực tiếp.

Đây là bản đồ module dựa trên biểu thức import có tên cố định, không phải trình phân tích phụ thuộc toàn diện. Đường dẫn import khác thường, alias TypeScript và dynamic import dùng biến có thể không phân giải được; UI phân biệt rõ module nội bộ và module ngoài/chưa phân giải.
