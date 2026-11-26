# TiG — nhân vật 3D dùng chung TigerIQ
Ngày 26/11/2026. Điều phối: [#5779 - Xây dựng nhân vật 3D modular dùng chung toàn TigerIQ](https://github.com/newsdayads/tigeriq-ai-lab/issues/5779). Phạm vi tài nguyên nhân vật, không thay thế quy tắc Driver, không khôi phục Animal City.

## Một nguồn thiết kế
Không sao chép thành hai bản thiết kế cạnh tranh. Cho đến khi master mới được duyệt, chuẩn nhận diện là [Living Character System](https://github.com/newsdayads/drivetrack/blob/main/docs/design/DEXSHOT_LIVING_CHARACTER_STANDARD_20261125.md) và [Manga visual](https://github.com/newsdayads/drivetrack/blob/main/docs/design/DEXSHOT_MANGA_OWNER_APPROVED_20261125.md) trong Driver, với [manifest](https://github.com/newsdayads/drivetrack/blob/main/docs/design/dexshot-living-character-v1.json). GOLDEN a5821d99e92425757f5b459860e4e2b8e5db0c3d và 13 GIF nguyên trạng; SHA ZIP 24ab670d13be191fdbfe02c97feef1f384945bab567d959563e2dc86eb033d62. Ảnh HQ là chuẩn đối chiếu, không phải texture chiếu mặt trước. Hình phía sau/chỗ bị quần áo che là đề xuất chưa duyệt. AI Lab quản lý tài nguyên master sau nghiệm thu; Driver chỉ tích hợp pack có version/hash, không đổi nghiệp vụ. Không tuyên bố các chat tự nạp.

## Hợp đồng tài nguyên
- Một thân 3D đầy đủ 360°, topology phù hợp biến dạng, UV/material, bộ xương và điểm gắn ổn định. Trục authoring Blender Z up, -Y front; xác minh đổi trục glTF lúc xuất.
- Tách quần áo mềm dùng chung bộ xương và weights, nón/tai nghe/đạo cụ qua socket; vật liệu đổi màu không sửa mesh, ẩn vùng cơ thể dưới quần áo bằng mask tương thích; xe riêng, điểm neo ghế/tay/vô lăng.
- Mỗi asset: id, version, rigVersion, sha256, nguồn/quyền sử dụng; pack dữ liệu không có code thực thi. Mọi clip dùng chung skeleton, có loop/one-shot, ngắt, pha trộn, expression/prop/priority; trạng thái nghiệp vụ từ ứng dụng.
- Ba đầu ra cùng nguồn .blend: GLB skeletal/morph animation, WebP động và ảnh tĩnh alpha. Driver giữ 3D khóa, GOLDEN fallback, timer 12 giây và capture ưu tiên; OTA sau gate riêng. Thay outfit trong Blender trước, runtime sau khi kiểm được.
- Mục tiêu khởi điểm mobile 30 FPS, LOD và dừng render khi ẩn; phải đo thật, không coi ngân sách là kết quả.

## Cổng và bằng chứng
G0: đọc nguồn, kiểm PC01/Blender và ZIP. G1: sculpt/retopology/UV, 8 góc, khớp mặt, mắt, tai, sọc, đuôi, dáng và bộ nhận diện, duyệt hình. G2: rig cơ thể/mặt, IK/FK, kiểm biến dạng. G3: hai outfit và socket, test xuyên mesh. G4: idle/capture/success pilot và chuyển tiếp; sau đó 13 trạng thái. G5: studio preview và xuất pack, validator, hash, đọc lại Drive. G6: tích hợp ứng viên riêng, nghiệm thu DeX trên máy thật, không tự OTA.
PC01: D:/TigerIQ/3D/TiG-Master. Blender 4.5.16 LTS đã chạy xuất file và render. Bản khối v001 CHƯA ĐẠT G1, chỉ là thử nghiệm kỹ thuật; mặt, tỷ lệ, màu/sọc và topology chưa đạt, không có rig/animation, không được tích hợp.
Drive đích riêng: https://drive.google.com/drive/folders/1rm52_wfRZyk9LKFLHNGmcdu4A3fF1wUJ (đã kiểm parent). Tài nguyên PC01 chưa tải lên. Bằng chứng và bước tiếp theo xem #5779. Không thay Loader: DRIVE_SYNC=NOT_REQUIRED.
