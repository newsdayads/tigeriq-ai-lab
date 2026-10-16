# P0 G3 — Bằng chứng Skill và năng lực AI trên nhánh riêng

- Công việc: [#4902 — Chuẩn hóa prompt từng bước, Skill, chống lặp và nghiệm thu thực](https://github.com/newsdayads/tigeriq-ai-lab/issues/4902).
- Nhánh riêng: `p0/4902-g3-work`.
- Đích PR nháp: `p0/owner-vy-core-coding-contract-20261016`, thuộc [PR #4898 — Core + Coding Lane](https://github.com/newsdayads/tigeriq-ai-lab/pull/4898).
- HEAD lúc tách nhánh: `ad7e140ecee5199a3150f1ba271fd8582037671c`; cây gốc `e4143424afa7ea64f435d40efdfedabf5c21ccf1`.
- `main` đã đọc: `a3084ed58f532087e3c83e38deb5b926d7894448`.
- Đối chiếu đích lúc mở PR: `8fa5b48cf49baacf6b9b7ed2c6c5c50e7c803256` (thêm 5 commit); không giao nhau với 5 đường dẫn G3. Không ghi nhánh đích và không đưa thay đổi của AI khác vào nhánh G3.
- Thời điểm lập bằng chứng: 2026-10-16T00:56:17.397343+00:00.
- Đã đọc Loader + 5 Bootstrap, AGENTS.md, OWNER_INTERACTION_V6, nội dung và 89 bình luận hiện hành của #504; nội dung và 4 bình luận của #4902; metadata thật của PR #4898. GitHub connector là nguồn, không dùng bộ nhớ thay trạng thái.

## Phạm vi thay đổi

Chỉ bốn tệp dưới đây và chính tài liệu bằng chứng này. Các tệp Coding Lane chính, step-contract, package.json, registry.yaml và mã của AI khác được giữ nguyên so với HEAD gốc.

| Tệp | Byte | SHA-256 |
| --- | ---: | --- |
| `apps/tigeriq-coding-lane/coding-skill-policy.mjs` | 7346 | `1889c0c3ed066f625755f99d8fc79eebaa1c6c425285bf4a4c1f15b61e26a34a` |
| `tests/coding-skill-policy.test.mjs` | 13286 | `c4943768e495e29afdf72eaa4426432eba186ff28dbeb7d284da5a7fae2c047a` |
| `docs/skills/frontend-engineering/SKILL.md` | 2879 | `360e88cc2effa6e9ae11341ab447ad3977475636099a022a5b10ddf288bc7821` |
| `docs/skills/backend-engineering/SKILL.md` | 2896 | `ef4a5c6ac06e8ea05cc6149029efb0c4782ed7fd73ad264f245866d91aa52d4a` |

Registry nhánh P0 không đổi: `docs/skills/registry.yaml`, 10450 byte, SHA-256 `b36ae5b3f23c5e164aead95d90c9f0c8b3709e8f49f588e6f8b9c2ba4fc4738f`.
Trên main, spec-first-tdd có cùng byte với nhánh gốc; frontend/backend chưa có entry trên main, chỉ là ứng viên ở nhánh P0.
13 tệp tham chiếu/kiểm thử đã được đối chiếu từng Git blob SHA-1 với cây HEAD gốc trước khi kiểm thử; dữ liệu nguyên byte được dùng, không thêm dòng mới khi tải nguồn.

## Lỗi đã tái hiện và sửa

1. Bằng chứng rỗng, thiếu hoặc trùng trước đây có thể được chấp nhận. Nay yêu cầu tập bằng chứng đầy đủ, đối chiếu định danh/phiên bản/byte, mục tiêu và hàm băm.
2. Bản kê có ACTIVE nhưng tài liệu thiếu/sai Identity, khác phiên bản hoặc ghi CANDIDATE từng được nạp. Nay đối chiếu cả bản kê và nội dung thật; không nâng trạng thái.
3. Chọn theo điểm liên quan có thể đẩy Skill bắt buộc ra ngoài giới hạn ba Skill, hoặc làm khác nội dung giữa người giao và người rà soát. Nay chỉ nạp danh sách bắt buộc, theo thứ tự xác định.
4. Bằng chứng có thể bị giữ nguyên trong khi contextBlock đã thay. Nay tính lại hàm băm, phân tách đúng nội dung theo số ký tự, đo byte UTF-8 và so với từng bằng chứng; từ chối thay cả metadata hoặc chèn nội dung thừa.
5. Ngân sách cũ chỉ tính thân tài liệu; mã tạo câu lệnh vai trò hiện hữu cắt ở 6000 ký tự và trim đầu/cuối. Nay tính cả khung, thêm dấu kết thúc để giữ nguyên byte xuống dòng cuối tệp; kiểm thử biên 6000 đạt, 6001 bị từ chối. Không sửa step-contract.
6. Từ chối tệp trống/mất/không đọc được, UTF-8 lỗi, đường dẫn symlink ra ngoài gốc Skill, loại/phiên bản không hợp lệ và tổng ngữ cảnh vượt mức.

## Kiểm thử trước/sau

Môi trường kiểm thử độc lập: Node.js `v24.19.0`; không PC01, không dịch vụ thật, không cơ sở dữ liệu chung.

- Trước sửa: cùng tệp kiểm thử G3 cuối đặt trên chính mã nguồn HEAD gốc; `node --test tests/coding-skill-policy.test.mjs`: 31 bài, 13 đạt, **18 lỗi**, mã thoát 1. Các lỗi mới bắt đúng bằng chứng rỗng/sai, nội dung thiếu định danh, byte/hàm băm, lấn ngân sách và lựa chọn Skill bắt buộc.
- Sau sửa: `node --check apps/tigeriq-coding-lane/coding-skill-policy.mjs`: mã thoát 0.
- Sau sửa: `node --test tests/coding-skill-policy.test.mjs tests/coding-step-contract.test.mjs tests/coding-p0-isolated-contract-journey.test.mjs`: **66/66 đạt**, 0 lỗi, 0 bỏ qua, mã thoát 0.
- Bộ G3 gồm 31 bài; 33 bài hợp đồng bước và 2 bài hành trình hợp đồng hiện hữu được chạy nguyên bản để kiểm tra tương thích.
- Một lần chạy mở rộng ban đầu thiếu bản sao `coding-lane.mjs` trong thư mục kiểm thử nên báo ENOENT; đã bổ sung đúng blob chỉ đọc và chạy lại. Đây không phải lỗi mã vận hành và không bị sửa bằng cách nới kiểm thử.
- CI GitHub đang chạy ở thời điểm lập tài liệu; chưa được coi đạt đúng SHA cuối. Đọc kết quả thật trên PR nháp; biên nhận CI cuối phải chỉ rõ SHA, không dùng CI cũ của nhánh Vy.

## Thử nạp Skill thật có bằng chứng

Đọc tệp canonical thật, không giả lập nội dung TDD:

```json
{
  "canary": "ISOLATED_REAL_FILE_ROLE_INJECTION",
  "id": "spec-first-tdd",
  "version": "1.1.0",
  "target": "coding-lane",
  "bytes": 2627,
  "content_sha256": "2b202e8f7e096d4c3015c5523550f533c47b740aaebf4f3fce735afbfc767b9f",
  "context_sha256": "ea1644e1446a5bda3bf54110a01d23c2b68a982078963147acd75abbff7903db",
  "model_invoked": false,
  "pc01_verified": false
}
```

Nội dung nguyên byte của `spec-first-tdd` được nạp vào bốn câu lệnh manager/implementer/reviewer/acceptor. Bằng chứng đi qua hàm tuần tự hóa và đọc lại packet hiện hữu, rồi được đối chiếu lại với lần nạp độc lập có cách diễn đạt mục tiêu khác. `context_sha256` trong packet hiện hữu ràng buộc toàn nội dung; biên nhận G3 bổ sung `content_sha256` riêng từng tệp mà không sửa schema packet.

Hai Skill frontend/backend version `0.1.0` vẫn **CANDIDATE** trong cả tài liệu và registry. Yêu cầu bắt buộc một trong hai bị từ chối bằng `CODING_REQUIRED_ACTIVE_SKILL_NOT_LOADED`; không hạ xuống TDD chung. Fixture ACTIVE chỉ là dữ liệu kiểm thử độc lập, không phải thăng hạng Skill thật.

## Phần chưa nghiệm thu

- Chưa gọi model/nhân sự AI thật hoặc chứng minh model có công cụ cần thiết; thử chèn nội dung không chứng minh năng lực coder.
- Chưa có bài sản phẩm frontend/backend chuyên biệt chạy bằng Skill ứng viên, chưa có rà soát độc lập và chưa cho phép thăng hạng registry.
- Chưa có Worker/Core/PC01 canary trực tiếp, chưa cài mã P0, chưa thử hoàn nguyên thiết bị; G3 toàn phần chưa nghiệm thu.
- Bằng chứng cũ dùng ngữ cảnh đã trim/khung cũ sẽ không khớp hàm băm mới và bị từ chối; cần tạo packet mới trong một thử nghiệm được phép, không tự làm mới job đang chạy.
- PR phải giữ NHÁP; nghiệm thu cuối của anh Sơn/Vy là cổng riêng. `DONE=false`. Không hợp nhất, phát hành, thay quyền hoặc sửa PC01.
- `DRIVE_SYNC=NOT_REQUIRED`: không thay Loader, Bootstrap hay điểm trỏ khởi động; tài liệu Skill ứng viên và chính sách G3 chưa được hợp nhất.
