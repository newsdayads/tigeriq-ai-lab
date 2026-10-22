# TIGERIQ GAME — HỢP ĐỒNG ĐIỀU PHỐI V2
Project: `tigeriq-game`; Parent: https://github.com/newsdayads/tigeriq-ai-lab/issues/5179.
Work Order hiện có: G01–G14 (Issue #5180–#5193). **Không mở lại hay tạo bản trùng**.

## Nguyên tắc thẻ
1. **Một hồ sơ tổng, không phải job:** #5179 theo dõi các công việc và hai đầu ra hợp lệ: STOP sau G10 nếu thử thất bại, hoặc phát triển tiếp sau GO và có nghiệm thu đến G14. Không dispatch thẻ tổng.
2. **Mỗi thẻ con là một kết quả:** mã Gxx, `PROJECT_ID`, `WORKSTREAM_ID`, `TARGET_ARTIFACT`, `CAPABILITY`, `RESOURCE_SCOPE`, checklist S01–S03 và biên nhận đóng.
3. **Nhận theo năng lực:** bất kỳ nhân viên đã được xác minh có đúng capability và quyền thực thi theo Registry đều có thể nhận, **không phải mọi nhân viên đều được lập trình hoặc có quyền ký phát hành**. NV02 self-pull độc lập, NV03 chỉ QA, NV04 nghiên cứu/rà soát theo phạm vi. Một phạm vi chỉ một chủ ghi và lease hợp lệ.
4. **Cô lập:** thẻ chỉ ghi vào tệp/nhánh thuộc `TARGET_ARTIFACT` và cập nhật trạng thái **chính thẻ đó**. Thay đổi tệp dùng chung phải có cổng phối hợp, PR hợp lệ và một chủ ghi; không tự sửa thẻ cha, đóng con khác hay tạo lệnh mới.
5. **Phụ thuộc thực:** `DEPENDENCY_POLICY=REQUIRE_ALL_TERMINAL_ACCEPTED` + `DEPENDS_ON=#...`, chỉ mở khi GitHub xác nhận issue tiền đề `closed/completed`. Luồng chỉ là DAG, không có vòng phụ thuộc. Hai nhánh độc lập được chạy song song nếu không giao nhau vùng ghi.
6. **Không vòng lặp:** cùng lỗi tối đa 2 lần thử, cùng SHA tối đa 2 lần xác minh; thiếu dữ liệu mới thì ở CHỜ có lý do và điều kiện đánh thức. Không rearm cùng SHA/biên nhận cũ, không tạo issue thay thế.
7. **Điểm kết thúc:** từng thẻ cần S01–S03 có chứng cứ, `DONE=true`, `FINISHED_AT`, `FINISH_RECEIPT_URL` và issue GitHub `closed/completed`. Parent không đạt 100% trước khi đủ kết quả cuối. Nếu G10 kết luận STOP, G11–G14 chỉ đóng `not_planned`, parent kết thúc với nhãn STOPPED, tuyệt đối không gọi là sản phẩm hoàn tất.
8. **Không tạo hàng đợi mới:** dùng GitHub Issue + Core scheduler đang tồn tại, `projects/tigeriq-game/project.yaml` là khai báo dự án. Không tự cài Core lên PC01 chỉ vì GitHub đã đổi.

## Điểm đầu/cuối và nhóm
| Nhóm | Mã / Issue | Sẵn sàng khi |
|---|---|---|
| Khởi tạo | G01 #5180 | Không phụ thuộc |
| Thiết kế | G02 #5181, G03 #5182 | G01 → G02 → G03 |
| Nền mã | G04 #5183 | G01 |
| Lõi | G05 #5184, G06 #5185, G07 #5186 | G02+G04 → G05; G03+G05 → G06 → G07 |
| QA | G08 #5187, G09 #5188, G10 #5189 | G05+G06+G07 → G08; G06 → G09; G08+G09 → G10 |
| Mở rộng | G11 #5190, G12 #5191 | G07+G10 → G11; G10+G11 → G12 |
| Kinh doanh | G13 #5192, G14 #5193 | G10 → G13; G11+G12+G13 → G14 |

## Chỉ số tổng hợp nguồn thực
`childrenTotal=14`.
`accepted=COUNT(issue.closed && issue.state_reason===completed && V2 valid && chứng cứ verified)`.
`blocked=COUNT(hold/gate thực)`; `running=COUNT(job sống + lease + heartbeat)`; `ready=COUNT(đủ phụ thuộc+an toàn chưa claim)`.
Thiếu bằng chứng runtime không tính đang làm; không dùng GitHub timestamp làm thời điểm thực thi. M0 lập kế hoạch đã nghiệm thu nhưng KHÔNG phải hoàn tất sản phẩm.

## Bản đầu / quyền
Nơi triển khai ban đầu: **`apps/tigeriq-game/` trong kho chính như một gói độc lập, không phụ thuộc ứng dụng khác** để loại bỏ cổng tạo repository mới chưa có kết nối. Khi đủ công cụ có thể tách ra `newsdayads/tigeriq-game` bằng một thay đổi có kiểm thử, không mở thêm 14 thẻ.
Không sản xuất 3D, không mở tài khoản thanh toán/nạp tiền, không thu dữ liệu cá nhân; chỉ Web 2D và 5 màn.
Cổng chi phí, quyền, bí mật, bảo mật, phát hành, pháp lý vẫn tách biệt.

## Nghiệm thu chính hợp đồng
- 14 thẻ qua `validateWorkOrderLifecycleV2`; không thể tự nhận thẻ tổng.
- Core admission chấp nhận thẻ đầu hợp lệ; máy kiểm tra dependency chặn mọi thẻ có tiền đề chưa `closed/completed`, không tạo job chạy.
- Giao diện Work Center gom theo parent khi parent nằm trong tập dữ liệu, mặc định thu gọn thẻ con; nút mở thật.
- Không thay trạng thái một thẻ chỉ vì thẻ khác có PR, issue comment hoặc heartbeat.
- Mọi thay đổi GitHub phải PR, CI đạt, kiểm tra `main` và môi trường vận hành riêng sau khi phát hành.
