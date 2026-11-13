# TIGERIQ — THIẾT KẾ SẢN PHẨM 3D CHÍNH XÁC (CANDIDATE)

## Định danh
- ID: `product-3d-engineering`
- Version: `0.1.0`
- State: `CANDIDATE` — chưa kích hoạt trong TigerIQ Core, ChatGPT hoặc PC01.
- Target: physical-product-design / CAD / FDM 3D printing / product visualization.
- Owner request: 2026-11-12, nạp quy trình thiết kế sản phẩm 3D và thiết kế chuyên nghiệp, có kiểm chứng.
- Quyền: đọc bản vẽ, dựng bản nháp và phân tích ngoại tuyến trong phạm vi được giao. Không tự cài đặt công cụ, chạy trình cài, điều khiển PC01 hoặc phát hành sản xuất khi chưa qua cổng thực tế.

## Nguồn nghiên cứu (PINNED, chỉ tham khảo quy trình)
1. CAD/OpenSCAD: `andreahaku/openscad_claude_skill`, `SKILL.md`, Git blob `b47323afb68c2f3847a809359aae4121e5af1512`, repo README tuyên bố MIT. Cần xác minh thông báo bản quyền trước khi sao chép mã.
2. Blender/kiểm tra hình và dựng hình: `mattjamo/bpy_skill`, `SKILL.md`, Git blob `cb85f2ec6b30b5aa0510fea6911d0022e1798c65`; `LICENSE` Apache-2.0 blob `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64`.
3. Nguồn phụ được xem xét: `flowful-ai/cad-skill` có giấy phép phi thương mại; **không** sao chép vào TigerIQ hoặc dùng cho mục đích kinh doanh khi chưa thẩm định riêng.

Đây là tài liệu TigerIQ tự biên soạn; KHÔNG chứa mã thực thi lấy từ bên ngoài. Các lệnh và máy chủ điều khiển cục bộ từ upstream không được nạp tự động. `external-skill-security-gate` tiếp tục là cổng bắt buộc trước mọi thực thi.

## Khi nào dùng
- Thiết kế vật thể thực, phụ kiện ô tô, hộc để đồ, giá đỡ, vỏ bảo vệ, linh kiện cơ khí, vật thể in 3D.
- Thiết kế từ ảnh thật, phác thảo, tài liệu kích thước; sửa mẫu STL, STEP, 3MF đã có.
- Dựng hình ảnh sản phẩm nhiều góc; cần đánh giá tính thẩm mỹ nhưng **mô hình CAD là nguồn sự thật về hình học**.

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
- Nạp tài liệu này ở mức **đọc/chỉ dẫn thiết kế**, chưa phải cài chương trình trên host.
- Tuyệt đối không khởi chạy `git clone`, `pip install`, `npm install`, máy chủ Blender bridge hoặc lệnh shell của upstream chỉ vì đã đọc SKILL.md.
- Nếu thực thi trên PC01: kiểm tra kết nối và quyền phiên, theo MCP trước, RDC dự phòng; không vượt quyền, không chiếm tài nguyên writer khác.
- Không sao chép upstream script khi chưa kiểm tra giấy phép, dependency, network, quyền file, và `external-skill-security-gate`; mọi kiểm thử/đưa vào vận hành phải có bằng chứng riêng.
- `DRIVE_SYNC=NOT_REQUIRED`: chỉ bổ sung Skill candidate, không thay Loader/điểm khởi động.
