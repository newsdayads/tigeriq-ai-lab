# TigerIQ Mobile Worker — Master Plan V1

Authority: #2949 - [P3][ANDROID] TigerIQ Mobile Worker — cụm AI Employee Android tự nhận việc, thực thi và tự cập nhật

> File này khóa kế hoạch V1. Mọi thay đổi contract/architecture/gate phải ghi SPEC_DELTA trong #2949; không sửa lịch sử để che delta.

# OWNER APPROVED MASTER JOB — 2026-10-02

## 1. Mục tiêu
Xây `TigerIQ Mobile Worker` để biến điện thoại Android chuyên dụng thành **worker node** của TigerIQ: nhận đúng việc từ Core, gắn đúng AI Employee, mở/điều khiển phiên AI phù hợp, trả kết quả/evidence về Core, hỗ trợ nhiều worker chạy song song và có cơ chế cập nhật tập trung.

Mục tiêu dài hạn: khai thác cụm điện thoại hiện có thành workforce AI có điều phối, không phụ thuộc một model/provider duy nhất và không biến UI automation thành control plane.

## 2. Quyết định Owner đã chốt
- Pilot bắt đầu bằng **Samsung Z Flip 7 đang có sẵn**; không chờ S7 mới bắt đầu source/build.
- Khi có S7 vật lý: chuyển sang compatibility + dedicated-device + Device Owner pilot.
- **Không được gọi MASTER JOB này HOÀN TẤT cho tới khi có chạy thật trên thiết bị, đủ evidence và Owner duyệt cuối.**
- Không được tự thay đổi kiến trúc sau khi plan đã khóa chỉ vì “có cách mới”. Mọi thay đổi kiến trúc/phạm vi phải:
  1. xuất phát từ bằng chứng thực tế hoặc blocker có thể tái hiện;
  2. ghi rõ delta + RCA + tác động;
  3. giữ backward compatibility khi có thể;
  4. nếu là thay đổi lớn, chờ Owner chấp thuận.
- Nguyên tắc triển khai: **build baseline → chạy thật → ghi evidence → fix đúng lỗi thật → retest**. Không “fix tưởng tượng” hàng loạt trước khi chạy thiết bị.
- Không đụng App Chrome; App Chrome là LOCAL-only scope riêng.

## 3. Kế thừa lịch sử, không reopen kiến trúc cũ
Historical references:
- #160 — Android Worker V1 — closed/not_planned.
- #537 — Android/S7 Worker contract + zero-cost capability routing — closed/not_planned.
- #543 — controller-v1 Android/device lease parity — closed/not_planned.
- PR #140 — historical Android Worker candidate, **không merge/replay nguyên trạng**.

Kế thừa các nguyên tắc còn đúng: device registration, device proof, heartbeat, lease, result/evidence, exactly-once/dedupe, one-resource-one-writer, GitHub OFF-MAIN, physical E2E gate.

Không kế thừa hard-coded endpoint/runtime/provider/employee mapping cũ nếu không còn đúng current source.

## 4. Kiến trúc khóa V1

```
Owner
  ↓
Vy
  ↓
TigerIQ Core / Scheduler / Fleet Manager
  ├─ Work Queue + Lease + Dedupe
  ├─ Workforce Registry
  ├─ GitHub Mutation Gate
  └─ Mobile Worker API
        ↓
TigerIQ Mobile Worker APK
  ├─ Device Identity
  ├─ Employee Binding
  ├─ Heartbeat / Job Client
  ├─ AI UI Adapter
  ├─ Automation State Machine
  ├─ Recovery Engine
  ├─ Evidence Client
  └─ Update Manager
        ↓
ChatGPT / Gemini / provider UI khác
```

### 4.1 Device ≠ AI Employee
- `DEVICE-xxx` là tài nguyên vật lý.
- `NVxxx` là AI Employee logic.
- Binding có thể đổi; identity công việc không phụ thuộc một máy cụ thể.

### 4.2 Quyền quyết định
- Core chọn/giao việc và giữ lease.
- Mobile Worker **không tự quét backlog, không tự chọn P0, không tự chiếm scope**.
- Android worker chỉ thực thi job đã giao và trả kết quả/evidence.
- GitHub `main` không bao giờ được điện thoại ghi trực tiếp.

### 4.3 GitHub execution modes
1. **RELAY MODE — mặc định V1:** AI trên điện thoại tạo output/patch/plan; kết quả trả Core; TigerIQ/Coding Lane áp dụng branch → PR → checks → independent review.
2. **DIRECT MODE — chỉ mở sau gate riêng:** chỉ khi provider/account/tool có GitHub write chính thức + quyền được kiểm chứng + one-writer guard. Không phải acceptance bắt buộc của pilot đầu.

## 5. AI UI Automation V1
Ưu tiên:
1. Accessibility node / text / resource-id / semantic state.
2. Hot-config selector từ Core.
3. Bounded fallback gesture/toạ độ chỉ khi selector không khả dụng.

Cấm:
- hard-code một bộ toạ độ rồi coi là kiến trúc chính;
- gửi khi không xác minh đúng app/chat/input state;
- tạo chat mới ngoài policy;
- gửi duplicate khi kết quả delivery chưa rõ.

State machine tối thiểu:
`UNENROLLED → READY → LEASED → OPENING_AI → VERIFYING_CONTEXT → SENDING → WAITING_AI → COLLECTING → REPORTING → READY`

Trạng thái lỗi:
`STALLED | AUTH_REQUIRED | UI_DRIFT | NETWORK_ERROR | APP_KILLED | UPDATE_REQUIRED | HUMAN_GATE`

Recovery phải bounded; không loop vô hạn.

## 6. Update Architecture — khóa từ V1

### 6.1 Hot Config — không cần cài APK
Core có thể version-control và đẩy:
- prompt template;
- continuation command pool;
- AI role/profile;
- selector/text/resource-id;
- timeout/retry/backoff;
- recovery rule;
- provider package/activity mapping;
- feature flag;
- rollout channel;
- min/max supported app version.

Mỗi config có `configVersion`, checksum và rollback pointer.

### 6.2 APK Update
Ba kênh:
- `DEV`: 1 máy.
- `CANARY`: 2–3 máy.
- `STABLE`: fleet đã được phép.

Manifest update tối thiểu:
`versionCode, versionName, apkUrl/artifactRef, sha256, signerFingerprint, channel, minSupportedVersion, releaseNotes, rolloutPercent`.

Bắt buộc:
- verify hash;
- verify signer lineage;
- không đổi package ID/signing key giữa các bản;
- update staged, không broadcast toàn fleet ngay.

### 6.3 Z Flip 7 pilot
Không biến điện thoại cá nhân của Owner thành Device Owner.
- Cài/update có xác nhận người dùng khi Android yêu cầu.
- Hot-config phải tự động, không cần reinstall.

### 6.4 S7 dedicated pilot
Sau khi Owner về có S7:
- audit model/Android/version/signer/package trước;
- chọn 1 máy lab;
- nếu cần Device Owner: factory reset + provisioning có kiểm soát;
- silent update chỉ bật sau gate Device Owner thật.

### 6.5 Rollback
Không dựa vào APK downgrade.
Forward rollback:
`bad v20 → restore good source/config → build v21 → rollout v21`.

## 7. Bảo mật / dữ liệu
- Không lưu mật khẩu Google/ChatGPT trong repo/log.
- Tận dụng session hợp lệ của app/provider trên thiết bị.
- Device key/proof dùng Android Keystore nếu cần.
- Secret/API key phải ở secret store phù hợp; không hard-code APK.
- Không mở credential/security boundary nếu chưa có authorization.
- Không truy cập dữ liệu cá nhân ngoài scope worker.
- Không dùng accessibility để thao tác ngoài provider/workflow được allowlist.

## 8. Kế hoạch gate tuần tự

### GATE A — SPEC + SOURCE BASELINE
- Master issue + spec V1 frozen.
- Audit repo hiện tại + historical PR #140.
- Chọn package/module mới hoặc forward-clean path.
- Build được APK debug/release candidate bằng CI.
- Unit tests + static safety gates.
**Không claim runtime.**

### GATE B — Z FLIP 7 LOCAL AI UI PILOT
- Owner cài APK candidate.
- Cấp quyền cần thiết.
- Worker mở đúng provider/chat.
- Ít nhất 10 chu kỳ command thật:
  - đúng chat;
  - không duplicate send;
  - nhận biết busy/ready;
  - bounded recovery qua ít nhất 1 app restart.
- Evidence: version, configVersion, timestamps, state transitions, failure/recovery logs.

### GATE C — CORE ↔ MOBILE EXACTLY-ONCE
- Enrollment/device identity.
- Heartbeat.
- Lease.
- Result/evidence.
- 10 job pilot có idempotency.
- Zero duplicate resource mutation.

### GATE D — REAL GITHUB RELAY JOB
Một task repo an toàn, nhỏ, thật:
`Core → Mobile NV → AI output → Core/Coding Lane branch → PR → checks → independent review`.
Không direct main.

### GATE E — UPDATE PROOF
1. Hot-config thay selector/prompt mà không reinstall.
2. DEV APK update version N→N+1.
3. Verify signer/hash.
4. App restart + heartbeat đúng version mới.
5. Forward rollback drill.

### GATE F — S7 COMPATIBILITY
Khi có máy:
- audit exact hardware/Android;
- install/update lineage;
- Accessibility compatibility;
- boot/restart/recovery;
- battery/background survival;
- ít nhất 20 chu kỳ thực tế trước khi xác nhận tương thích.

### GATE G — DEDICATED DEVICE / DEVICE OWNER
Chỉ trên S7 lab đã được Owner cho phép:
- provisioning có kiểm soát;
- silent APK update;
- reboot persistence;
- recovery sau update lỗi;
- không mất provider session ngoài kỳ vọng.

### GATE H — 3 DEVICE PARALLEL
- 3 worker độc lập.
- tối thiểu 30 jobs tổng.
- one-resource-one-writer.
- inject tối thiểu 3 lỗi: app kill, network interruption, stale lease.
- duplicate scope mutation = 0.

### GATE I — ROLE CHAIN
Một việc thật chạy:
`Coder → Tester → Independent Reviewer → GitHub Gate`.
Không cho implementer tự review chính scope.

### GATE J — 10 DEVICE PILOT
- capability routing;
- worker health;
- stalled-worker takeover;
- queue fairness;
- dashboard/telemetry;
- đo throughput/cycle time/intervention rate/recovery rate.
Không scale nếu dữ liệu cho thấy hiệu quả âm hoặc vận hành không ổn.

### GATE K — 30–50 DEVICE
Chỉ mở sau Owner review kết quả 10-device.
Bắt đầu multi-project/software-factory experiment.

### GATE L — 100–200 DEVICE
**OWNER EXPLICIT SCALE GATE.**
Không tự scale chỉ vì kỹ thuật có thể.

## 9. Acceptance cuối MASTER JOB
Chỉ được đóng `completed` khi TẤT CẢ điều kiện sau đạt:
1. Core giao đúng job cho đúng Mobile Worker.
2. Worker thực thi trên thiết bị thật và thu evidence thật.
3. Recovery được chứng minh.
4. Update config + APK được chứng minh.
5. Ít nhất 3 thiết bị chạy song song được chứng minh.
6. Một chuỗi coder→tester→reviewer→PR thật đạt.
7. Không có duplicate writer/scope mutation.
8. Tài liệu vận hành + onboarding thiết bị có thể lặp lại.
9. Các known blocker nghiêm trọng đã xử lý hoặc Owner chấp nhận rõ.
10. **OWNER_FINAL_ACCEPTANCE=APPROVED** bằng comment/quyết định explicit của anh Sơn.

Nếu 1–9 đạt nhưng mục 10 chưa có:
`STATE=READY_FOR_OWNER_FINAL_ACCEPTANCE`
và issue **vẫn OPEN**.

## 10. Quy tắc chống “kế hoạch đổi liên tục”
- SPEC_VERSION bắt đầu `MOBILE_WORKER_MASTER_V1`.
- Thay đổi nhỏ implementation không đổi contract: được phép, phải có evidence.
- Thay đổi contract/architecture/gate/permission/update strategy: phải tạo `SPEC_DELTA` trong master issue.
- Không rewrite lịch sử để làm plan “trông như chưa từng đổi”.
- Mỗi fix phải chỉ ra:
  `EVIDENCE → ROOT_CAUSE → CHANGE → RETEST → RESULT`.
- Không mở hàng loạt issue song song trước khi gate thực tế yêu cầu.
- Mặc định dùng master checklist + PR; child issue chỉ tạo khi có scope độc lập thật và phải link master.

## 11. Metrics bắt buộc
Ghi số thật, không ước lượng:
- job completion rate;
- Owner/manual intervention rate;
- median/p95 job cycle time;
- duplicate send count;
- wrong-chat/wrong-context count;
- recovery success rate;
- stale lease recovery;
- app-kill survival;
- update success/failure;
- battery/network observations;
- GitHub PR pass/rework ratio.

## 12. Prompt thực thi chuẩn
```
LÀM — NO YAPPING.

Thực thi Master Job TigerIQ Mobile Worker theo đúng MOBILE_WORKER_MASTER_V1.

MỤC TIÊU:
Biến Android thành worker node có quản lý của TigerIQ: nhận job từ Core, gắn đúng AI Employee, điều khiển đúng phiên AI, trả result/evidence, hỗ trợ recovery và cập nhật tập trung. Pilot Z Flip 7 trước, S7 sau khi có thiết bị.

NGUYÊN TẮC CỨNG:
1. Không đổi kiến trúc/gate đã khóa nếu chưa có evidence thực tế bắt buộc; architectural delta phải ghi SPEC_DELTA và chờ Owner nếu ảnh hưởng lớn.
2. Build baseline trước; chạy thiết bị thật càng sớm càng tốt; chỉ fix dựa trên lỗi tái hiện/evidence.
3. GitHub source: branch → PR → exact-head checks → independent review → merge. Không direct main.
4. Mobile Worker không tự chọn backlog/P0 và không tự chiếm scope. Core giao job; worker execute.
5. Device != AI Employee. Binding tách biệt.
6. RELAY MODE là mặc định; điện thoại không direct-write main.
7. Accessibility semantic selector trước; hot-config selector; toạ độ chỉ bounded fallback.
8. Exactly-once/dedupe/one-resource-one-writer bắt buộc.
9. Update: Hot Config + DEV/CANARY/STABLE APK; verify SHA256 + signer; forward rollback.
10. Không đụng App Chrome.
11. Không paid/Production/credential/security widening/destructive action nếu thiếu Owner gate.
12. Không claim ĐẠT/HOÀN TẤT nếu thiếu evidence thật.
13. MASTER JOB chỉ được HOÀN TẤT khi OWNER_FINAL_ACCEPTANCE=APPROVED.

THỨ TỰ:
GATE A → B → C → D → E → F → G → H → I → J → K → L.
Không nhảy gate để tạo cảm giác tiến độ.
Nếu gate phụ thuộc thiết bị chưa có, hoàn thành tối đa phần source/test an toàn rồi checkpoint CHỜ THIẾT BỊ; không bịa runtime PASS.

MỖI LỖI:
EVIDENCE → ROOT_CAUSE → FIX NHỎ NHẤT → TEST → RETEST THỰC TẾ → CHECKPOINT.

BÁO CÁO:
KẾT QUẢ → BỊ CHẶN → BƯỚC TIẾP THEO.
Chỉ hiển thị % khi có checklist/evidence định lượng thật.
```

## 13. Trạng thái khởi tạo
`SPEC_VERSION=MOBILE_WORKER_MASTER_V1`
`OWNER_PLAN_APPROVED=2026-10-02`
`EXECUTION_AUTHORIZED_SAFE_REVERSIBLE_ZERO_COST=true`
`CURRENT_GATE=A`
`MASTER_COMPLETION_OWNER_GATE=true`
`OWNER_FINAL_ACCEPTANCE=PENDING`
`STATE=ACTIVE_GATE_A_SPEC_SOURCE_BASELINE`
