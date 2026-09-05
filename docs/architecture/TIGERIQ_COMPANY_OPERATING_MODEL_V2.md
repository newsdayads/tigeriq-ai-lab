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
5. Mọi purchase, paid subscription, borrowing, investment hoặc financial commitment đều thuộc Owner authority bất kể số tiền. Budget limit chỉ là giới hạn của authorization đã được phê duyệt, không tự tạo quyền chi.
6. Việc pháp lý trọng yếu, bảo mật cao, Production release, không thể đảo ngược hoặc vượt quyền phải đưa lên Owner theo Constitution.
7. Mỗi nhiệm vụ phải gắn với một mục tiêu/KPI hoặc một nghĩa vụ vận hành rõ ràng.
8. Kết quả kinh doanh quan trọng hơn hoạt động của agent.
9. Không đánh đồng AI Employee với model. Employee giữ vai trò và trách nhiệm; model chỉ là năng lực có thể thay đổi.
10. Không bắt buộc Reviewer/Judge cho mọi việc. Mức kiểm tra phụ thuộc rủi ro của từng action.
11. Hệ thống phải lưu được trạng thái vận hành để tiếp tục sau restart, lỗi mạng hoặc đổi model.
12. Hệ thống phải ưu tiên ngoại lệ cần xử lý, không bắt Owner theo dõi mọi hoạt động bình thường.
13. Mỗi tính năng kỹ thuật mới phải trả lời được nó cải thiện bước nào trong vòng vận hành công ty.

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
AUTHORIZE / POLICY GATE — kiểm tra quyền + policy + risk + approval
        ↓
EXECUTE — thực hiện bằng công cụ/runtime được phép
        ↓
VERIFY — kiểm tra theo mức rủi ro của action
        ↓
MEASURE — cập nhật KPI / business outcome
        ↓
LEARN / CORRECT — điều chỉnh trong cùng authority envelope
        ↺
```

`Exception / CẦN SẾP` là side-channel có thể phát sinh từ bất kỳ bước nào, không chỉ cuối vòng.

Một action chỉ được EXECUTE khi toàn bộ lớp ràng buộc tương ứng đều cho phép theo thứ tự ưu tiên hiện hành: Owner instruction → Constitution → security/architecture policy đã phê duyệt → Process/Mission scope → Employee permission → Tool permission → risk/approval policy.

Effective authority luôn là giao của các quyền, không phải hợp: `Owner delegation ∩ Process/Mission policy ∩ Employee permissions ∩ Tool permissions ∩ Risk/approval policy`.

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

Chief of Staff và mọi A5 bị cấm:
- tự cấp hoặc phân phối credential/permission;
- tự nâng autonomy của chính mình;
- thay đổi approval/risk policy;
- ủy quyền quyền mà nó không sở hữu;
- tự review/judge output của chính mình khi policy yêu cầu độc lập;
- che giấu mandatory escalation;
- tự authorize Production release, financial/legal commitment hoặc irreversible action thuộc Owner authority.

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
- job_refs;
- decision/approval_ref khi có;
- current status;
- business outcome.

`job_refs` chỉ là quan hệ/tham chiếu tới runtime Job; không tạo một danh sách Job authoritative thứ hai.

### Exception / Owner Action
Ngoại lệ không nên tự giải quyết hoặc vượt quyền hiện tại.

Phải ghi rõ:
- điều gì xảy ra;
- tác động;
- hệ thống đã thử gì;
- phương án đề xuất;
- Owner cần quyết định cụ thể điều gì;
- thời hạn nếu có;
- immutable `decision/approval_ref` khi Owner đã quyết định, ưu tiên tái sử dụng Evidence/Decision Log.

### Business Outcome
Kết quả thực tế sau khi Mission/Process hoàn tất.

Không chỉ ghi `job done`; phải ghi được ảnh hưởng tới KPI hoặc mục tiêu khi có thể.

## 6. Mức tự chủ của AI Employee

Autonomy chỉ quyết định mức độ độc lập khi thực hiện một action đã được phép. Autonomy không mở rộng permission, không hạ risk floor và không bỏ qua approval requirement.

### A0 — Quan sát
Chỉ đọc dữ liệu, không thay đổi gì.

### A1 — Đề xuất
Được phân tích và đề xuất; không thực hiện hành động bên ngoài.

### A2 — Chuẩn bị
Được tạo draft/kế hoạch/tài liệu để người hoặc cấp cao hơn duyệt.

### A3 — Tự thực hiện việc rủi ro thấp
Được thực hiện hành động có thể đảo ngược, nằm trong quyền và giới hạn đã định.

### A4 — Tự quản một quy trình trong giới hạn
Được tự chạy quy trình, retry/sửa lỗi thông thường chỉ trong cùng approved authority envelope và đưa ngoại lệ lên cấp trên khi vượt envelope.

### A5 — Tự điều phối một phạm vi nghiệp vụ
Chỉ áp dụng sau khi đã có lịch sử đủ tin cậy. Có thể tạo Mission và phân việc trong phạm vi được ủy quyền; không được tạo thêm permission, thay risk/approval policy hoặc vượt các quyền Constitution dành cho Owner.

Mức tự chủ phải gắn với phạm vi, không gán một mức chung cho mọi hành động của Employee.

## 7. Mức kiểm tra theo rủi ro

Risk được phân loại theo từng action, không theo Employee hoặc toàn Mission. Policy định nghĩa hard minimum floor theo loại action và không được downgrade dưới floor.

### R0 — Rủi ro rất thấp
Ví dụ: đọc, tóm tắt, nghiên cứu sơ bộ.  
Xử lý: tự thực hiện + kiểm tra định dạng/logic đơn giản nếu có.

### R1 — Rủi ro thấp
Ví dụ: chuẩn bị báo cáo, cập nhật dữ liệu có thể sửa lại.  
Xử lý: tự thực hiện + kiểm tra quy tắc; có thể lấy mẫu review.

### R2 — Rủi ro trung bình
Ví dụ: communication ra ngoài hoặc data mutation có tác động nhưng vẫn reversible và không chạm hard floor cao hơn.  
Xử lý: validation mạnh hơn hoặc independent Reviewer theo process policy.

### R3 — Rủi ro cao
Ví dụ: high-impact security/engineering hoặc thay đổi quan trọng.  
Xử lý: independent Reviewer bắt buộc; Judge khi policy yêu cầu.

### R4 — Rủi ro rất cao / Owner authority
Ví dụ: mọi financial commitment, Production release, material legal action, hợp đồng, hành động không thể đảo ngược.  
Xử lý: Reviewer/Judge theo policy + Owner approval bắt buộc khi thuộc Owner authority.

Hard floors tối thiểu:
- mọi purchase/subscription/borrowing/investment/financial commitment = R4 + Owner;
- Production release = R4 + Owner;
- material legal/irreversible action = R4;
- high-impact security/engineering = ít nhất R3 + independent review;
- external/customer communication và business data mutation không được hạ dưới floor mà process policy quy định.

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
- PostgreSQL TigerIQ là nguồn thật về trạng thái điều phối/mission/job/runtime và các bản chiếu cần thiết cho vận hành;
- restricted/private personal hoặc sensitive information bị loại khỏi general Company Context trừ khi một Business Process xác định rõ nhu cầu và authority cho phép;
- credential/secret không được copy vào Business Context;
- mỗi external projection phải có tối thiểu `source_system`, `source_ref`, `observed_at` và khi có thì `source_version`/etag;
- projection là read-only/cacheable view; khi xung đột, authoritative source thắng;
- chỉ giữ minimum necessary metadata/summary.

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
3. Finance ước tính chi phí và thời gian hoàn vốn sơ bộ, không tạo financial commitment.
4. Sales đánh giá khả năng tìm khách, không liên hệ khách hàng trong pilot.
5. Chief xếp hạng TOP cơ hội bằng fixed scoring rubric.

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
- điểm ưu tiên;
- source refs cho mọi material factual claim;
- evidence freshness/confidence;
- deduplication với cơ hội tương đương;
- reversible next experiment proposal không phát sinh paid commitment/customer contact.

### Fixed scoring rubric cho TOP 3
- customer problem;
- TigerIQ fit / asset leverage;
- evidence strength;
- monetization path;
- estimated test effort/cost;
- risk;
- time-to-test.

### KPI Pilot
- coverage target: ít nhất 5 cơ hội đủ dữ liệu, nhưng không dùng số lượng làm KPI chính;
- all material factual claims có source refs; không invented market/financial facts;
- bằng chứng có freshness/confidence;
- không phát sinh chi phí trả phí;
- không liên hệ khách hàng hoặc cam kết bên ngoài ở pilot này;
- xuất TOP 3 evidence-traceable bằng fixed rubric;
- mỗi TOP 3 có reversible next experiment proposal;
- primary KPI: quality/traceability + closed-loop autonomous completion;
- Web sau này phải hiển thị Goal → Mission → Jobs → Outcome.

### Mức rủi ro
R1 cho research/proposal actions của pilot. Bất kỳ action nào vượt research/proposal phải phân loại lại theo action-level risk floor.

### Điều kiện PASS
- vòng Goal → Signal → Mission → Work → Result/Evidence → Outcome chạy được;
- Chief có thể tổng hợp và xếp hạng bằng fixed rubric;
- TOP 3 có evidence traceable và reversible next experiment;
- không cần Owner can thiệp giữa vòng trừ khi có exception thật;
- không có paid commitment/customer contact;
- kết quả đủ chất lượng để Owner quyết định bước thử nghiệm tiếp theo.

## 14. Điều kiện khóa thiết kế WO-049

Trước khi mở rộng feature kỹ thuật lớn, cần:
1. Review độc lập tài liệu này ở exact head sau reconciliation.
2. Chốt data model tầng business.
3. Chốt autonomy/risk policy.
4. Chốt Company Control Tower information architecture.
5. Chốt COMPANY-001 acceptance.
6. Tạo work order kỹ thuật riêng cho từng chat.

Không merge MAIN/Production trong giai đoạn thiết kế này nếu chưa có Owner release authorization.