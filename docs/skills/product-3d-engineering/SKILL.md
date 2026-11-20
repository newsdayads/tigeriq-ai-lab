# TIGERIQ — THIẾT KẾ SẢN PHẨM 3D CHÍNH XÁC (CANDIDATE)

## Định danh
- ID: `product-3d-engineering`
- Version: `0.2.0`
- State: `CANDIDATE` — tài liệu chưa qua xét duyệt ACTIVE; công cụ CAD 0.11.13 đã cài và kiểm thử thực trên PC01 (20/11/2026), không suy ra ChatGPT/Core tự nạp.
- Target: physical-product-design / CAD / FDM 3D printing / product visualization.
- Owner request: 2026-11-12, nạp quy trình thiết kế sản phẩm 3D và thiết kế chuyên nghiệp, có kiểm chứng.
- Quyền: thiết kế, xuất và kiểm tra file CAD khi có chỉ đạo Owner; PC01 dùng MCP OAuth với quyền thực tế. Lệnh Owner 20/11/2026 đã cho phép cài thử công cụ CAD 0.11.13. Mọi lần cài mới/đổi phiên bản, phơi cổng mạng, in thật và phát hành sản xuất vẫn qua cổng riêng.

## Nguồn nghiên cứu (PINNED, chỉ tham khảo quy trình)
1. CAD/OpenSCAD: `andreahaku/openscad_claude_skill`, `SKILL.md`, Git blob `b47323afb68c2f3847a809359aae4121e5af1512`, repo README tuyên bố MIT. Cần xác minh thông báo bản quyền trước khi sao chép mã.
2. Blender/kiểm tra hình và dựng hình: `mattjamo/bpy_skill`, `SKILL.md`, Git blob `cb85f2ec6b30b5aa0510fea6911d0022e1798c65`; `LICENSE` Apache-2.0 blob `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64`.
3. Nguồn phụ được xem xét: `flowful-ai/cad-skill` có giấy phép phi thương mại; **không** sao chép vào TigerIQ hoặc dùng cho mục đích kinh doanh khi chưa thẩm định riêng.

Đây là tài liệu TigerIQ tự biên soạn; KHÔNG chứa mã thực thi lấy từ bên ngoài. Các lệnh và máy chủ điều khiển cục bộ từ upstream không được nạp tự động. `external-skill-security-gate` tiếp tục là cổng bắt buộc trước mọi thực thi.

## Khi nào dùng
- Thiết kế vật thể thực, phụ kiện ô tô, hộc để đồ, giá đỡ, vỏ bảo vệ, linh kiện cơ khí, vật thể in 3D.
- Thiết kế từ ảnh thật, phác thảo, tài liệu kích thước; sửa mẫu STL, STEP, 3MF đã có.
- Dựng hình ảnh sản phẩm nhiều góc; cần đánh giá tính thẩm mỹ nhưng **mô hình CAD là nguồn sự thật về hình học**.


## Tích hợp text-to-cad — đã kiểm thử trên PC01 (20/11/2026)
- Upstream: `https://github.com/earthtojake/text-to-cad` (MIT); PyPI distribution `cad==0.11.13`. Wheel `cad-0.11.13-py3-none-any.whl`, SHA-256 `aa7d30d5deda8c237886355e82a4bc29414686e84fb890a5da5445e44e51bc1a`. Không sử dụng tập lệnh tự tải `install.ps1`, không dùng `latest`, không tự bật cập nhật.
- Cài cách ly trên PC01: `D:\TigerIQ\Tools\text-to-cad-v0.11.13\Scripts\cad.exe`. Python 3.12, `uv` 0.13.9 nằm trong cùng môi trường. Không đổi PATH hệ thống, không cài plugin đại trà. Truy cập trình xem chỉ tại `127.0.0.1:3245`, không chia sẻ URL có token. Đã `cad telemetry off`, `cad update auto off`, `cad plugin update auto off`.
- Gọi trong PowerShell qua MCP PC01 (chỉ khi được giao thiết kế): thiết lập `DO_NOT_TRACK=1`, `CAD_TELEMETRY=0`, `CAD_UPDATE_CHECK=0`; kiểm tra `& 'D:\TigerIQ\Tools\text-to-cad-v0.11.13\Scripts\cad.exe' server status`, nếu chưa hoạt động mới chạy `server start`; dùng `cad run <path-to-model.py>` để dựng; xuất `STEP/STL/3MF` từ **cùng một mô hình**, không thay bằng hình AI minh họa. Không chạy server trên `0.0.0.0` hoặc dùng đường hầm công khai.
- Kích hoạt theo mục tiêu: Khi anh Sơn giao `vẽ 3D`, `thiết kế 3D`, `làm mẫu in 3D`, `sửa STL/3MF/STEP`, `vỏ hộp`, `giá đỡ`, `mô hình cơ khí` hoặc `bản vẽ CAD` cho **vật thể thực**, ưu tiên kỹ năng này và công cụ CAD tham số. Ảnh minh họa 3D đơn thuần không đồng nghĩa bản CAD/in được; nếu chỉ xin hình minh họa thì định tuyến sang công cụ hình ảnh.
- Đầu ra mặc định cho yêu cầu thiết kế sản phẩm: (1) kích thước mm và các giả định, (2) mã nguồn Python `build123d`/mô hình tham số, (3) STEP, STL, 3MF theo mục tiêu, (4) ảnh xem trước **từ mô hình**, (5) kiểm tra kích thước, tính kín, dung sai, khả năng in, (6) bản vẽ kỹ thuật nếu yêu cầu/thiết kế có số đo sản xuất, (7) lưu thành phẩm đã xác minh vào thư mục `TigerIQ 3D` trên Google Drive theo `docs/3d/GOOGLE_DRIVE_DESTINATION.md`.
- Không tự phát lệnh in Bambu P1S, không tự cắt lớp rồi tuyên bố đã in, không thay đổi tài khoản/thiết bị, không đưa file hoặc máy chủ ra Internet. File 3MF xuất từ CAD **không tự chứng minh** đã cắt lớp trong Bambu Studio.
- Bằng chứng canary PC01: `JOB-TIGERIQ-CAD-INSTALL-20261120` và `JOB-TIGERIQ-CAD-SMOKE-RERUN-20261120`; `JOB-TIGERIQ-CAD-MESH-CHECK-20261120`. Mô hình `bracket_smoke` 40×20×6 mm, 124 tam giác STL, 186 cạnh kín, 0 mặt suy biến, đã xuất `STEP/STL/3MF`. Tệp `D:\TigerIQ\Canary\cad-20261120\`. Chưa có bằng chứng nghiệm thu Bambu Studio/in thực hoặc cổng nâng Skill lên ACTIVE.
- Quy tắc nạp liên phiên: nguồn GitHub `main` sau khi hợp nhất, không suy luận các chat ChatGPT/Gemini tự động nhận Skill hoặc tự có quyền điều khiển PC01. Nếu còn CANDIDATE thì dùng quy trình đã kiểm thử theo nhiệm vụ Owner trong phạm vi cho phép, nhưng **không nói Skill ACTIVE**.

## Quy trình bắt buộc
1. **Khôi phục**: lấy ảnh, phác thảo, số đo hiện có và mẫu in lỗi; không hỏi lại dữ liệu đã có. Phân biệt số đo lọt lòng, phủ bì, khe hở, dung sai, và đơn vị mm.
2. **Chuẩn hóa yêu cầu**: xác nhận hướng trước/sau/trên/dưới, bề mặt gá, miệng lấy đồ, tải trọng, vật liệu, máy in; lập bảng thông số bất biến và bất kỳ mâu thuẫn hình học.
3. **Ràng buộc hình học**: mô hình tham số bằng CAD (OpenSCAD/CadQuery/FreeCAD hoặc tương đương). Không lấy hình AI minh họa làm bản thiết kế. Nếu có xung đột kích thước thì nêu rõ trước khi xuất sản xuất.
4. **Bản vẽ 2D**: xuất hình chiếu trước/trên/cạnh, mặt cắt chính, bản vẽ lắp từ **cùng một** mô hình 3D; ghi kích thước, hướng, thước tỷ lệ, dung sai. Các hình chiếu phải khớp nhau và khớp mã nguồn.
5. **Xem trước có kiểm chứng**: kết xuất 4–6 góc từ chính lưới STL/CAD, nền tương phản. Nếu trình xem tương tác không hoạt động, xuất ảnh thật nhiều góc hoặc video quay mô hình, tuyệt đối không tráo ảnh tạo sinh rồi gọi là hình từ STL.
6. **Rà soát**: kiểm tra hình kín/manifold, pháp tuyến, biên ranh, chiều dày thành, đáy, vách, khe lắp, giao nhau, bản lề, hướng in, overhang, support, khả năng lắp thực tế và chênh lệch sau co ngót.
7. **In 3D**: xuất bản nguồn tham số + STEP (nếu khả dụng) + STL và 3MF; kiểm tra lại import, tọa độ, kích thước và mặt đặt trên bàn trong Bambu Studio; chỉ nêu "sẵn sàng in" sau khi cắt lớp và kiểm tra cảnh báo bằng chứng.
8. **Nghiệm thu vật lý**: đối chiếu sản phẩm in với số đo và ảnh thực tế, kiểm tra lắp/tháo, nhiệt độ cabin, độ dính mặt gá, độ rung/chống rơi. In thử mẫu tiết diện/đoạn gá khi phù hợp trước bản đầy đủ.

## Quy tắc thiết kế cho hộc cửa gió của anh Sơn
- Bối cảnh V1 đã in, còn trượt đồ do bị chúi khi gắn. Cấm phát hành bản V2 chỉ từ một ảnh minh họa.
- Bản V2 đang thảo luận: **4 cột**, ngang lọt lòng **60/50/23/79 mm = 212 mm**; cột 1 chia tầng thẻ/chuột; không có nắp và không có thanh chắn trước; mặt dán phía trên sâu **42 mm**; sâu đáy lọt lòng **86 mm**; cao chứa đồ mục tiêu **23 mm**; phần đuôi muốn nghiêng **12°**.
- **Mâu thuẫn cần giải quyết bằng mặt cắt**: 2 mm khe thẻ + 21 mm khe chuột = 23 mm trước khi cộng vách tầng và dung sai; không thể vừa giữ 23 mm *lọt lòng* vừa thêm vách tầng dương nếu không thay hình học. Góc đuôi 12° không được phép vô ý làm giảm chiều cao chứa đồ 23 mm.
- Khi sửa V2: phân biệt "góc gá/lắp" với "góc đáy trong để chống trượt", xác định hệ tọa độ và kiểm chứng trọng lực sau khi gắn trên xe. Không tự thay đổi ý nghĩa góc theo giả định.

## Kiểm tra đầu ra / bằng chứng
- `CAD_PARAMETERS`: bảng số đo chuẩn, khẳng định mọi giá trị lọt lòng/phủ bì.
- `ORTHOGRAPHIC_VIEWS`: bản vẽ 3 hình chiếu và mặt cắt từ cùng hình học.
- `MESH_VALIDATION`: số đo bbox, watertight, mesh issues, và trạng thái kiểm tra.
- `MULTI_ANGLE_PREVIEW`: ảnh kiểm tra từ mô hình thật, có nhãn góc.
- `SLICER_EVIDENCE`: Bambu P1S / vật liệu / hướng đặt / cảnh báo cắt lớp.
- `STATUS`: CANDIDATE, không tự ghi ACTIVE hoặc khẳng định PC01 đã cài nếu không có biên nhận.

## Bảo mật và triển khai
- Phân biệt tài liệu Skill còn CANDIDATE với bộ công cụ CAD đã cài thực trên PC01; không đồng nhất trạng thái.
- Không tự khởi chạy `git clone`, `pip install`, `npm install`, máy chủ Blender bridge hoặc lệnh shell của upstream **chỉ vì đọc SKILL.md**. Phạm vi cài PC01 20/11/2026 đã được Owner giao trực tiếp và có biên nhận độc lập.
- Nếu thực thi trên PC01: kiểm tra kết nối và quyền phiên, theo MCP trước, RDC dự phòng; không vượt quyền, không chiếm tài nguyên writer khác.
- Không sao chép upstream script khi chưa kiểm tra giấy phép, dependency, network, quyền file, và `external-skill-security-gate`; mọi kiểm thử/đưa vào vận hành phải có bằng chứng riêng.
- `DRIVE_SYNC=NOT_REQUIRED`: chỉ bổ sung Skill candidate, không thay Loader/điểm khởi động.
