# TigerIQ Project Code Map — phiên bản dùng được qua dòng lệnh

Yêu cầu Node.js >= 20. Không cần cài thêm gói cho công cụ.

Chạy trực tiếp trong repository:

```bash
npm run code-map -- --root . --output code-map.json
```

Hoặc xuất kết quả ra dòng lệnh:

```bash
node tools/project-code-map/cli.mjs --root .
```

Kết quả JSON chứa `schemaVersion`, `sourceRevision` (nếu truyền biến `TIGERIQ_SOURCE_SHA`), `summary.sourceFiles`, `summary.dependencyEdges`, `nodes` và `edges` (`from` đường dẫn mã nguồn tương đối, `to` tên module hoặc đường dẫn import). Không xuất nội dung mã nguồn, không phụ thuộc PC01, khóa bí mật hoặc API trả phí.

Công cụ nhận diện import tĩnh và `import('literal')` động; không tự giải quyết đường dẫn tới tệp đích, không tuyên bố hỗ trợ JavaScript/TypeScript syntax toàn phần hoặc import động có biến. Bỏ qua thư mục phụ thuộc và mã sinh phổ biến.

GitHub Actions: `.github/workflows/project-code-map-live.yml` chạy trên mã nguồn thật ở mỗi PR và lần hợp nhất liên quan, rồi xuất `tigeriq-code-map.json` thành gói tải về `TigerIQ-Code-Map-<SHA>`. Phải kiểm tra kết quả job và tệp thật trước khi coi bước nghiệm thu hoàn tất.

Kiểm thử offline:

```bash
node --test tests/project-code-map-cli.test.mjs
```
