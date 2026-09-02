# TIGERIQ — COMPANY OPERATING MODEL V2

Status: DRAFT FOR INTERNAL REVIEW  
Work Order: WO-049 / Issue #143  
Branch: `wo049/company-operating-model-v2`  
Scope: Business operating model. No MAIN/Production mutation.

## 1. Mục tiêu

TigerIQ là một công ty AI-native do Owner định hướng bằng mục tiêu, giới hạn và các quyết định quan trọng. Hệ thống phải tự vận hành phần lớn công việc thường ngày trong phạm vi được ủy quyền: tự quan sát tình hình, phát hiện việc cần làm, lập nhiệm vụ, điều phối bộ phận/nhân viên AI, thực hiện, kiểm tra, đo kết quả, tự điều chỉnh và chỉ đưa ngoại lệ quan trọng lên Owner.

Engineering chỉ là một bộ phận. PC01, Android, PostgreSQL, AI Router, Prompt Architect và Web Control là hạ tầng phục vụ công ty, không phải mục tiêu cuối cùng của TigerIQ.

## 2. Nguyên tắc điều hành

1. Quản trị bằng mục tiêu và kết quả, không quản trị bằng số lượng task.
2. Công ty phải có khả năng tự phát hiện việc cần làm; không phụ thuộc hoàn toàn vào việc Owner giao từng task.
3. Mỗi công việc tự động phải nằm trong một phạm vi quyền rõ ràng.
4. Việc có thể đảo ngược, rủi ro thấp và nằm trong quyền được phép thì hệ thống tự thực hiện.
5. Việc tài chính, pháp lý, bảo mật cao, không thể đảo ngược hoặc vượt quyền phải đưa lên Owner theo Constitution.
6. Mỗi nhiệm vụ phải gắn với một mục tiêu/KPI hoặc một nghĩa vụ vận hành rõ ràng.
7. Kết quả kinh doanh quan trọng hơn hoạt động của agent.
8. Không đánh đồng AI Employee với model. Employee giữ vai trò và trách nhiệm; model chỉ là năng lực có thể thay đổi.
9. Không bắt buộc Reviewer/Judge cho mọi việc. Mức kiểm tra phụ thuộc rủi ro.
10. Hệ thống phải lưu được trạng thái vận hành để tiếp tục sau restart, lỗi mạng hoặc đổi model.
11. Hệ thống phải ưu tiên ngoại lệ cần xử lý, không bắt Owner theo dõi mọi hoạt động bình thường.
12. Mỗi tính năng kỹ thuật mới phải trả lời được nó cải thiện bước nào trong vòng vận hành công ty.

## 3. Vòng vận hành chuẩn

```text
OWNER GOAL / LIMITS
        ↓
SENSE — quan sát tín hiệu kinh doanh
        ↓
INTERPRET — hiểu khoảng cách so với mục tiêu
        ↓
PLAN — tạo Mission và kết quả mong đợi
        ↓
ASSIGN — giao bộ phận / AI Employee
        ↓
EXECUTE — thực hiện bằng công cụ/runtime được phép
        ↓
VERIFY — kiểm tra theo mức rủi ro
        ↓
MEASURE — cập nhật KPI / business outcome
        ↓
LEARN / CORRECT — điều chỉnh trong phạm vi quyền
        ↓
ESCALATE — chỉ đưa ngoại lệ cần Owner quyết định
        ↺
```

## 4. Các lớp của công ty

### 4.1. Owner / Strategy
Owner đặt:
- mục tiêu dài hạn và ngắn hạn;
- ưu tiên;
- giới hạn chi phí;
- vùng được phép tự động;
- ngưỡng cần phê duyệt;
- lệnh dừng hoặc thay đổi hướng.

### 4.2. Trợ lý điều hành trung tâm — Chief of Staff
Chief of Staff chịu trách nhiệm:
- theo dõi mục tiêu và KPI;
- đọc tín hiệu/sự kiện quan trọng;
- xác định vấn đề hoặc cơ hội;
- tạo Mission;
- chọn bộ phận/năng lực cần tham gia;
- theo dõi tiến độ và kết quả;
- điều phối việc sửa sai;
- quản lý ngoại lệ;
- báo cáo ngắn gọn cho Owner.

Chief of Staff không phải nơi lưu trạng thái duy nhất, không trực tiếp sở hữu mọi credential, không tự review/judge việc của chính mình và không thay thế các hệ thống nghiệp vụ.

### 4.3. Bộ phận
Các bộ phận là nhóm năng lực ổn định:
- Research / Nghiên cứu;
- Product / Sản phẩm;
- Sales / Kinh doanh;
- Marketing / Tiếp thị;
- Finance / Tài chính;
- Operations / Vận hành;
- Engineering / Kỹ thuật.

Bộ phận không bắt buộc phải có nhiều AI Employee ngay từ đầu. Chỉ tạo thêm nhân sự khi có khối lượng công việc lặp lại hoặc vai trò cần tách quyền rõ ràng.

### 4.4. Mission Team
Mission Team là nhóm tạm thời được tạo để đạt một kết quả cụ thể, có thể gồm nhiều bộ phận.

Ví dụ: `Tăng doanh thu thêm 30 triệu/tháng` có thể cần Research + Sales + Marketing + Finance + Operations.

### 4.5. AI Employee
Mỗi AI Employee phải có tối thiểu:
- Employee ID;
- tên hiển thị;
- bộ phận;
- vai trò;
- quản lý/supervisor;
- capability;
- quyền;
- mức tự chủ;
- KPI;
- giới hạn chi phí nếu có;
- loại công cụ được phép dùng;
- trạng thái: active / suspended / retired;
- lịch sử kết quả chính.

Model/provider không phải là danh tính của Employee.

## 5. Mô hình dữ liệu nghiệp vụ cần bổ sung

Runtime hiện có vẫn giữ Job/Lease/Result/Evidence/Review. Tầng nghiệp vụ bổ sung các khái niệm sau:

### Goal
Mục tiêu Owner hoặc mục tiêu công ty cần đạt.

Trường chính:
- goal_id;
- title;
- objective;
- owner;
- priority;
- start/end;
- status;
- constraints;
- related_kpis.

### KPI / Target
Chỉ số dùng để đo Goal hoặc Process.

Trường chính:
- kpi_id;
- name;
- unit;
- baseline;
- target;
- current_value;
- direction;
- warning_threshold;
- critical_threshold;
- source_ref;
- updated_at.

### Signal / Event
Tín hiệu cho biết điều gì đã thay đổi hoặc cần chú ý.

Ví dụ:
- doanh thu thấp hơn target;
- có lead mới;
- hóa đơn quá hạn;
- đối thủ đổi giá;
- job thất bại nhiều lần;
- khách phản hồi tiêu cực.

Signal chỉ là dữ kiện; chưa phải quyết định.

### Business Process
Quy trình lặp lại của công ty.

Mỗi Process phải có:
- trigger;
- input;
- các bước chính;
- quyền cần thiết;
- KPI;
- các ngoại lệ;
- điểm cần phê duyệt;
- điều kiện hoàn tất.

### Mission
Một chiến dịch/nhiệm vụ cấp công ty được tạo để xử lý một Goal, Signal hoặc vấn đề.

Mission có:
- expected outcome;
- owner/supervisor;
- participating departments;
- risk level;
- deadline;
- budget limit;
- jobs;
- current status;
- business outcome.

### Exception / Owner Action
Ngoại lệ không nên tự giải quyết hoặc vượt quyền hiện tại.

Phải ghi rõ:
- điều gì xảy ra;
- tác động;
- hệ thống đã thử gì;
- phương án đề xuất;
- Owner cần quyết định cụ thể điều gì;
- thời hạn nếu có.

### Business Outcome
Kết quả thực tế sau khi Mission/Process hoàn tất.

Không chỉ ghi `job done`; phải ghi được ảnh hưởng tới KPI hoặc mục tiêu khi có thể.

## 6. Mức tự chủ của AI Employee

### A0 — Quan sát
Chỉ đọc dữ liệu, không thay đổi gì.

### A1 — Đề xuất
Được phân tích và đề xuất; không thực hiện hành động bên ngoài.

### A2 — Chuẩn bị
Được tạo draft/kế hoạch/tài liệu để người hoặc cấp cao hơn duyệt.

### A3 — Tự thực hiện việc rủi ro thấp
Được thực hiện hành động có thể đảo ngược, nằm trong quyền và giới hạn đã định.

### A4 — Tự quản một quy trình trong giới hạn
Được tự chạy quy trình, tự retry/sửa lỗi thông thường và chỉ đưa ngoại lệ lên cấp trên.

### A5 — Tự điều phối một phạm vi nghiệp vụ
Chỉ áp dụng sau khi đã có lịch sử đủ tin cậy. Có thể tạo Mission và phân việc trong phạm vi được ủy quyền; vẫn không vượt các quyền Constitution dành cho Owner.

Mức tự chủ phải gắn với phạm vi, không gán một mức chung cho mọi hành động của Employee.

## 7. Mức kiểm tra theo rủi ro

### R0 — Rủi ro rất thấp
Ví dụ: đọc, tóm tắt, nghiên cứu sơ bộ.  
Xử lý: tự thực hiện + kiểm tra định dạng/logic đơn giản nếu có.

### R1 — Rủi ro thấp
Ví dụ: chuẩn bị báo cáo, cập nhật dữ liệu có thể sửa lại.  
Xử lý: tự thực hiện + kiểm tra quy tắc; có thể lấy mẫu review.

### R2 — Rủi ro trung bình
Ví dụ: gửi thông tin ra ngoài, thay đổi dữ liệu nghiệp vụ có tác động.  
Xử lý: validation mạnh hơn hoặc independent Reviewer tùy process.

### R3 — Rủi ro cao
Ví dụ: thay đổi quan trọng, security, quyết định có tác động lớn.  
Xử lý: independent Reviewer bắt buộc; Judge khi policy yêu cầu.

### R4 — Rủi ro rất cao / Owner authority
Ví dụ: chi tiền đáng kể, hợp đồng, release chính thức, hành động không thể đảo ngược.  
Xử lý: Reviewer/Judge theo policy + Owner phê duyệt khi Constitution yêu cầu.

## 8. Quản lý theo ngoại lệ

Web/Control Tower phải ưu tiên một hàng đợi `CẦN SẾP` thay vì buộc Owner đọc toàn bộ log.

Mỗi ngoại lệ hiển thị tối thiểu:
- mức độ;
- liên quan mục tiêu nào;
- vấn đề;
- ảnh hưởng;
- hệ thống đã xử lý gì;
- đề xuất;
- quyết định Owner cần đưa ra.

Các hoạt động bình thường phải được tổng hợp, không làm phiền Owner.

## 9. Business Context / trí nhớ công ty

TigerIQ cần lớp ngữ cảnh doanh nghiệp nhưng không sao chép tất cả dữ liệu vào PostgreSQL runtime.

Nguyên tắc:
- CRM là nguồn thật về khách hàng khi CRM tồn tại;
- accounting là nguồn thật về kế toán khi hệ thống kế toán tồn tại;
- Drive là nguồn thật về tài liệu;
- Calendar là nguồn thật về lịch;
- PostgreSQL TigerIQ là nguồn thật về trạng thái điều phối/mission/job/runtime và các bản chiếu cần thiết cho vận hành.

TigerIQ giữ liên kết, metadata, quyền và bản tóm tắt cần thiết để Chief/Employee hiểu ngữ cảnh nhưng tránh tạo nguồn dữ liệu song song không cần thiết.

## 10. Company Control Tower

Trang chủ cho Owner phải ưu tiên:
1. Mục tiêu quan trọng và mức đạt KPI.
2. Tình hình doanh thu/chi phí/kết quả nếu có dữ liệu.
3. Mission đang chạy.
4. Bộ phận và AI Employee đang hoạt động.
5. Ngoại lệ `CẦN SẾP`.
6. Kết quả kinh doanh mới hoàn thành.
7. Sức khỏe các quy trình chính.
8. Sức khỏe hệ thống kỹ thuật ở mức tổng hợp.

Chi tiết CI, SHA, lease, provider log, port và kỹ thuật sâu chuyển xuống mục Vận hành kỹ thuật.

## 11. Ánh xạ hệ thống hiện có

### Web Control PR #117
EXTEND/HOLD: giữ preview; không mở rộng trang kỹ thuật. Sau khi model này được review, đổi cấu trúc thông tin thành Company Control Tower.

### PC01 / Controller PR #116
KEEP: runtime spine; chịu trách nhiệm nhận/giao Job, kết quả, heartbeat, kết nối PostgreSQL. Không chứa business strategy.

### PostgreSQL / Work State PR #141
KEEP + EXTEND UPWARD: giữ toàn bộ semantics Job/Lease/Result/Evidence. Thiết kế migration tiếp theo cho KPI/Signal/Mission/Exception/Outcome sau khi model được khóa.

### AI Coordinator + Prompt Architect PR #111
KEEP: năng lực chọn AI/model và tạo prompt. Không phải Chief of Staff.

### Android PR #140
KEEP/HOLD FEATURE EXPANSION: worker thực thi trên thiết bị. Chỉ mở thêm capability khi một Business Process thật cần.

### Governance / Independent Review
KEEP: áp nghiêm cho release/security/high-risk; business task thường dùng risk policy ở mục 7.

## 12. Nhịp vận hành công ty

### Liên tục
- nhận Signal/Event;
- kiểm tra ngưỡng cảnh báo;
- tạo/cập nhật Mission khi policy cho phép;
- chạy Process đã kích hoạt;
- xử lý retry/recovery;
- đẩy Exception.

### Hằng ngày
Chief of Staff tạo bản tóm tắt:
- mục tiêu lệch nhiều nhất;
- việc quan trọng đang chạy;
- kết quả mới;
- ngoại lệ cần Owner;
- việc hệ thống tự điều chỉnh.

### Hằng tuần
- xem KPI;
- đánh giá hiệu quả Employee/Process;
- xác định quy trình nên tự động hóa thêm;
- dừng hoặc sửa workflow không tạo giá trị.

### Hằng tháng
- đánh giá mục tiêu;
- ROI của AI/workflows;
- năng lực cần bổ sung;
- mức tự chủ nào có thể tăng/giảm;
- chiến lược cần Owner điều chỉnh.

## 13. Pilot đầu tiên — COMPANY-001

Tên: `Radar cơ hội kinh doanh TigerIQ`.

Mục tiêu: chứng minh một vòng tự vận hành cấp công ty với rủi ro thấp và kết quả đo được.

### Goal
Tạo danh sách cơ hội kinh doanh thực tế, có căn cứ, phù hợp nguồn lực TigerIQ.

### Tín hiệu
- lịch chạy định kỳ hoặc Owner kích hoạt;
- thông tin thị trường mới;
- sản phẩm/công nghệ mới;
- tài sản/năng lực hiện có chưa được khai thác.

### Mission
1. Research tìm cơ hội.
2. Product đánh giá khả năng tạo sản phẩm/dịch vụ.
3. Finance ước tính chi phí và thời gian hoàn vốn sơ bộ.
4. Sales đánh giá khả năng tìm khách.
5. Chief xếp hạng TOP cơ hội.

### Kết quả bắt buộc
Mỗi cơ hội phải có:
- vấn đề khách hàng;
- khách hàng mục tiêu;
- giải pháp TigerIQ có thể cung cấp;
- bằng chứng thị trường;
- cách kiếm tiền;
- chi phí thử nghiệm sơ bộ;
- thời gian thử nghiệm;
- rủi ro;
- điểm ưu tiên.

### KPI Pilot
- ít nhất 5 cơ hội đủ dữ liệu;
- ít nhất 3 nguồn bằng chứng cho mỗi cơ hội quan trọng khi phù hợp;
- không phát sinh chi phí trả phí;
- không liên hệ khách hàng hoặc cam kết bên ngoài ở pilot này;
- xuất TOP 3 cho Owner;
- Web sau này phải hiển thị Goal → Mission → Jobs → Outcome.

### Mức rủi ro
R1. Nghiên cứu và đề xuất; không có hành động tài chính/khách hàng.

### Điều kiện PASS
- vòng Goal → Signal → Mission → Work → Result/Evidence → Outcome chạy được;
- Chief có thể tổng hợp và xếp hạng;
- không cần Owner can thiệp giữa vòng trừ khi có exception thật;
- kết quả có thể dùng để quyết định bước thử nghiệm tiếp theo.

## 14. Điều kiện khóa thiết kế WO-049

Trước khi mở rộng feature kỹ thuật lớn, cần:
1. Review độc lập tài liệu này.
2. Chốt data model tầng business.
3. Chốt autonomy/risk policy.
4. Chốt Company Control Tower information architecture.
5. Chốt COMPANY-001 acceptance.
6. Tạo work order kỹ thuật riêng cho từng chat.

Không merge MAIN/Production trong giai đoạn thiết kế này nếu chưa có Owner release authorization.