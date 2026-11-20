# TIGERIQ 3D — PC01 CAD 0.11.13 kiểm thử 2026-11-20

## Nguồn và bảo mật
- Upstream: https://github.com/earthtojake/text-to-cad, MIT, phiên bản `cad==0.11.13`.
- PyPI wheel: `cad-0.11.13-py3-none-any.whl`, sha256 `aa7d30d5deda8c237886355e82a4bc29414686e84fb890a5da5445e44e51bc1a` (metadata PyPI đối chiếu từ PC01).
- Cài riêng vào `D:\TigerIQ\Tools\text-to-cad-v0.11.13`, không dùng tập lệnh `install.ps1`, không đăng ký plugin vào mọi ứng dụng.
- Tắt thống kê và tự cập nhật; viewer lắng nghe cục bộ `127.0.0.1:3245`. Giữ bí mật đường dẫn có token.
- Quyền: Owner chỉ đạo trực tiếp; không in tự động, không phát hành ra Internet, không cấp quyền hệ thống.

## Biên nhận PC01
- `JOB-MCP-a00df8ef-7ad7-4d34-b5b7-b026646e330d`: trước cài không có cad/cad-server trên PATH.
- `JOB-TIGERIQ-CAD-INSTALL-20261120`: cài `cad 0.11.13`, kiểm tra `cad --version` và file thực thi thành công.
- `JOB-TIGERIQ-CAD-SERVER-20261120`: khởi động máy chủ CAD nội bộ, kiểm tra `cad server status`.
- `JOB-TIGERIQ-CAD-SMOKE-RERUN-20261120`: mô hình tham số bracket 40x20x6 mm; xuất `bracket_smoke.step` 21,869 bytes, `bracket_smoke.stl` 6,284 bytes, `bracket_smoke.3mf` 2,073 bytes.
- `JOB-TIGERIQ-CAD-MESH-CHECK-20261120`: PASS: STL 124 triangles, kích thước đúng [40,20,6] mm, 186 cạnh nội bộ xuất hiện đúng hai lần, 0 mặt suy biến; STEP có header ISO-10303-21; 3MF là ZIP chứa .model.
- `JOB-TIGERIQ-CAD-QA-20261120`: `telemetry off`, `update auto off`, `plugin update auto off`. Lệnh `cad stl inspect` không có; thay bằng script kiểm tra STL độc lập (trên).

## Trạng thái
- Đã đạt: cài đặt, mô hình tham số, STEP/STL/3MF, kiểm tra cấu trúc lưới.
- Chưa đạt: độc lập rà soát PR, xác minh cắt lớp Bambu Studio, nghiệm thu in vật lý, đánh giá thăng hạng Skill ACTIVE, nghiệm thu liên phiên ChatGPT/Gemini.
- Skill trạng thái `CANDIDATE` cho tới khi có đầy đủ bằng chứng; không được nói toàn hệ thống đã tự động nhận.
- `DRIVE_SYNC=NOT_REQUIRED`: thay đổi SKILL/registry trên GitHub không thay đổi Loader.
