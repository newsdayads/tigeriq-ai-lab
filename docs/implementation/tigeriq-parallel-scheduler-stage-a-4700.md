# TigerIQ — Stage A: đặc tả sửa điều phối song song và nghiệm thu (GH-4700)

**Trạng thái tài liệu:** Đề xuất thiết kế và kế hoạch kiểm thử; **chưa triển khai Scheduler, chưa nghiệm thu runtime**.  
**Nguồn công việc:** [GH-4700](https://github.com/newsdayads/tigeriq-ai-lab/issues/4700); [sổ điều phối GH-280](https://github.com/newsdayads/tigeriq-ai-lab/issues/280); [chính sách GH-1456](https://github.com/newsdayads/tigeriq-ai-lab/issues/1456).  
**Đối tượng:** Core GitHub Intake, Coding Lane, shared resource lease, Lifecycle V2, người kiểm tra/Owner.  
**Ranh giới:** PR này **chỉ** thêm tài liệu dưới `docs/implementation/`. Không đổi mã nguồn, không mở quyền protected control-plane, không tác động PC01, điện thoại, Production, secrets, billing hoặc App Chrome.

## A01 — RCA có căn cứ và độ tin cậy

| Mã | Nhận định có thể kiểm tra | Căn cứ mã nguồn | Tác động và giới hạn kết luận |
| --- | --- | --- | --- |
| RCA-01 | `managerTick()` được `await` trước vòng `while(active.size < MAX_PARALLEL)`. Mỗi lần `managerTick` lựa chọn **một** objective và trả về tối đa một coding job. | [Coding Lane: managerTick / scheduler](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-coding-lane/coding-lane.mjs#L959-L1023), [main loop](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-coding-lane/coding-lane.mjs#L1688-L1716) | Một request Manager chậm có thể trì hoãn **claim job mới**, dù các job đã chạy không bị dừng bởi riêng `await` này. Đây là nghẽn lập lịch, không phải bằng chứng tiến trình single-thread không hỗ trợ I/O song song. |
| RCA-02 | GitHub Coding Intake mặc định cap **3 objective**, có thể cấu hình tối đa 8; Coding Lane mặc định cap **6 job**, tối đa 6. | [github-coding-intake.mjs](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-core/github-coding-intake.mjs#L16-L18), [intake scheduling](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-core/github-coding-intake.mjs#L446-L462), [Coding Lane limits](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-coding-lane/coding-lane.mjs#L345-L358) | Slot Intake và slot Worker khác nhau; không được cộng thành 9 worker hay coi cấu hình là throughput thực. |
| RCA-03 | `selectableResources()` lọc resource bị bận và resource không đủ điều kiện từ Core; `pickResource()` có thể trả null. Core health snapshot có TTL 10 giây, fetch timeout 3 giây, lỗi thì fail-closed. | [Coding Lane: resource gate](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-coding-lane/coding-lane.mjs#L468-L503) | `ONLINE` không đủ: cần health fresh, model phù hợp, slot/lease, quota và output contract. Cấm tăng `MAX_PARALLEL` để lách điều kiện này. |
| RCA-04 | Manager dùng `invokeJsonWithFailover` và contract `continue|blocked` + một `job`; job writer dùng compact edit + validate path, reviewer tách implementer. | [Coding Manager](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-coding-lane/coding-lane.mjs#L959-L1024), [Coding job + review](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-coding-lane/coding-lane.mjs#L1489-L1607) | `OUTPUT_CONTRACT_EXHAUSTED`/no-op có thể thất bại **trước PR**; không thể dùng probe thành công làm bằng chứng Coding DONE. |
| RCA-05 | `claimJob()` bỏ ứng viên giao nhau về file với job `running/review/waiting_ci`, dùng transaction và `FOR UPDATE SKIP LOCKED`. | [Coding Lane claim](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-coding-lane/coding-lane.mjs#L1269-L1290) | Khóa là bất biến an toàn cần giữ; cải thiện song song chỉ cho công việc có phạm vi độc lập. |
| RCA-06 | Shared lease dùng một `resource_id`/hàng DB, `on conflict(resource_id) do nothing`, token/TTL/heartbeat/release; mặc định TTL 5 phút và heartbeat 30 giây. | [Shared resource lease](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-core/shared-resource-lease.mjs#L1-L5), [acquire](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-core/shared-resource-lease.mjs#L72-L146) | Không đồng thời chiếm cùng một AI; cần fence token trên mọi commit kết quả và phục hồi sau timeout/restart. |
| RCA-07 | Core có `KEEP_OPEN_ON_STEP_COMPLETE`; ngược lại Coding Intake, khi một objective `completed` và sourceRevision khớp, có nhánh gọi `close(issue)`. | [Core intake](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-core/github-intake.mjs#L1495-L1502), [Coding result / close](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-core/github-coding-intake.mjs#L605-L650) | **Rủi ro** đóng Parent nhiều mốc từ một PR. Chưa có bằng chứng lỗi này đã xảy ra; phải viết regression trước sửa chính sách đóng. |
| RCA-08 | Coding auto-recovery có danh sách lỗi retryable và mặc định tối đa 3 job/objective; Coding Intake có ngân sách 2 retry. | [autonomy-supervisor.mjs](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-coding-lane/autonomy-supervisor.mjs#L1-L24), [Coding Intake budget](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/apps/tigeriq-core/github-coding-intake.mjs#L16-L18) | Retry có giới hạn là đúng; cần chặn vòng phục hồi lặp theo `failure_signature`, `sourceRevision` và dữ liệu sức khỏe resource. |

**Runtime baseline quan sát qua PC01 12/10/2026 (không phải chứng nhận trạng thái tương lai):** Core/Coding Lane có phản hồi; số resource Coding rảnh hợp lệ thay đổi từ 0 đến 1; quan sát nhiều objective `OUTPUT_CONTRACT_EXHAUSTED`, `CODING_ALL_BATCHES_NOOP`, `DENY_CONTROL_PLANE_MUTATION`. Trong GH-4700, Core từng nhận rồi thất bại với `RESTART_RECONCILIATION_FAIL_CLOSED` theo [lịch sử issue](https://github.com/newsdayads/tigeriq-ai-lab/issues/4700); chưa có bằng chứng PR/runtime hoàn thành. Đừng biến các snapshot thành dữ liệu SLA hay điều tra root cause VRAM mà chưa có trace.

## A02 — Kiến trúc 2 scheduler độc lập

**Thiết kế đề xuất; chưa phải chức năng đang chạy:**

```text
GitHub Work Order P1–P5 -> canonical admission + dependency/owner gate
  -> durable Parent queue -> child DAG planner
  -> READY_CHILD queue
      -> Manager scheduler (bounded concurrency, separate task group)
           -> scoped validated job blueprint + immutable plan revision
      -> Worker scheduler (separate task group; NEVER await Manager tick)
           -> eligibility/lease/path conflict -> runJob -> CI -> review -> acceptance
  -> result reconciler -> GitHub statuses / evidence / next eligible child
```

**Manager dispatcher:** mỗi tick claim nhiều `READY_FOR_PLANNING` bằng PostgreSQL `FOR UPDATE SKIP LOCKED` (ví dụ cấu hình 2 concurrent Manager, không mặc định ép tăng). Dùng `manager_active`/semaphore riêng, time budget và `AbortSignal` của từng request; một Manager timeout không chặn `workerTick()`. Tuyệt đối không `await managerTick()` nối trực tiếp trong đường claim Worker. Manager chỉ xuất **job blueprint**; không viết main, không tự xác nhận kết quả.

**Worker dispatcher:** claim nhiều `READY_CHILD` tới `min(workerSlotCap, eligibleResources, independentScopes)` bằng vòng nhanh không đợi Manager; giữ state vào DB trước khi chạy I/O, lock cạnh tranh giao file như hiện tại. `MAX_PARALLEL=6` là **trần**, không phải mục tiêu đủ 6 bằng mọi giá. Đặt cap thực nghiệm từ tài nguyên khỏe và reviewer tồn tại.

**Fairness:** ưu tiên P1>P2>P3>P4>P5 giữa các job *đủ điều kiện*, nhưng aging có giới hạn tránh job P5 chết đói; round-robin theo `project_id` khi cùng priority; giới hạn backlog/manager in-flight per project. Retry job về queue theo `next_attempt_at`, không chiếm slot khi chờ backoff. Release lease trong `finally` với token khớp.

**Backpressure:** khi `READY_CHILD` vượt ngưỡng cấu hình, giảm nhận Parent mới; khi không có reviewer hoặc resource, chuyển `WAITING_RESOURCE` với lý do + timestamp, không spawn vô hạn job. Dùng retry budget có chỉ số, visibility timeout và TTL. Scheduler phải ghi event `QUEUED/CLAIMED/WORKING/WAITING_REVIEW/ACCEPTED/BLOCKED` có correlation IDs.

**Điều kiện tương tranh:** trong PostgreSQL transaction duy nhất, claim dựa trên khóa Parent/Child + resource scope; nếu 2 scheduler cùng claim, đúng 1 thắng. Duplicate webhook, restart hoặc phản hồi AI trễ không được tạo writer thứ hai.

## A03 — Parent Work Order → Child Task DAG

**Đối tượng tối thiểu**:

| Field | Parent | Child |
| --- | --- | --- |
| Khóa | `work_order_id = GH-<issue>` + canonical `source_revision` | `task_id = GH-<issue>:<step-key>:<plan-revision>` duy nhất |
| Phạm vi | project, workstream, `resource_scope`, quyền Owner | tập đường dẫn `allowed_paths`, `resource_scope`, capability |
| Đầu ra | acceptance policy, required child set, evidence | deliverable cụ thể, ví dụ PR/commit/test/device receipt |
| Phụ thuộc | danh sách milestone bắt buộc | `depends_on_task_ids`, `read_set/write_set` nếu có |
| Tài nguyên | kết quả tổng hợp, không giữ AI lease lâu | `employee_id, resource_id, lease_token, fencing_epoch` |
| Vòng đời | OPEN / WORKING / VERIFY / DONE / BLOCKED | QUEUED / READY / CLAIMED / RUNNING / REVIEW / ACCEPTED / FAILED / BLOCKED |

Mỗi checklist được **đề xuất** ánh xạ 1–N Child theo định nghĩa tác vụ và cổng quyền; không biến checkbox chỉ để hiển thị thành executor job. Kiểm tra DAG không chu trình, parent sourceRevision khớp và nguồn không bị SUPERSEDED. Chiều dữ liệu: Child receipt → Parent aggregation, không suy diễn Parent DONE từ `completed` của một Coding objective.

Một Child được READY chỉ khi: thuộc đúng Parent active; không có dependency chưa ACCEPTED; current planRevision khớp; quyền action hợp lệ; không có conflict writable scope; có ít nhất một resource đủ năng lực sau health + lease gate.

## A04 — Resource routing, lock và fencing

**Selector bắt buộc:** role/capability match → credential/quotas healthy → functional evidence thực cho taskKind → Core health fresh → no current job/no shared lease → allowed target/path scope → reviewer độc lập có thể được lựa chọn sau implementation. `NV102` dùng Mobile Worker lane, không giả thành coding API worker; NV02/NV03 có vai trò và cổng quyền riêng. Không lấy `ONLINE` làm pass chức năng.

**Conflict predicate:** hai task **không** được chạy đồng thời nếu chung `resource_id`, ghi cùng tệp/đường dẫn bao nhau, trùng exclusive resource scope, hay cùng thiết bị/action chưa được phép. Hai task chỉ đọc cùng dữ liệu có thể chạy song song khi không dùng exclusive claim. `tests/` quá rộng có thể làm mọi Coding work giao nhau: planner cần cấp **đường dẫn tệp cụ thể**, không chỉ thư mục chung, và fail-closed khi chưa xác định được tệp.

**Fencing:** `lease_token` gắn `fencing_epoch` tăng đơn điệu trong DB; mọi write/finish từ worker cần `WHERE task_id=? AND lease_token=? AND fencing_epoch=? AND source_revision=?` với row count 1. Lease hết hạn → acquire mới cùng task có epoch cao hơn; response worker cũ phải bị từ chối, ghi `STALE_RESULT_REJECTED`. PR branch riêng/expected-head SHA; không chạm main trực tiếp.

**Phục hồi:** TTL/heartbeat và cleanup stale occupancy đã tồn tại; mở rộng bằng atomic reconciler so sánh Job DB, shared lease, GitHub PR, source revision. Khi requeue chỉ một journal row/idempotency key; không tạo hai task/PR cho cùng mục tiêu.

## A05 — Phân loại lỗi và xử lý có giới hạn

| Nhóm lỗi | Cách xử lý đề xuất | Không được làm |
| --- | --- | --- |
| `OUTPUT_CONTRACT_EXHAUSTED`, JSON/schema không đạt | Lưu response metadata đã loại secrets, sửa schema prompt/repair ngắn; chuyển AI khác đủ năng lực một cách có giới hạn; xem xét prompt payload size; test output thật | Không ghi `DONE` dựa trên phản hồi text; không lặp vô hạn |
| `CODING_ALL_BATCHES_NOOP` / sửa không thay đổi | So `git diff`, `target paths`, baseline; nếu thực sự không cần thay đổi phải có minh chứng và check acceptance riêng | Không tự coi noop là PR hoàn tất |
| `timeout`, `RESTART_RECONCILIATION_FAIL_CLOSED` | Phân biệt request đang bận/không có heartbeat/Worker chết; reconcile leases rồi retry sau cooldown; không tái gửi thao tác ngoại hệ thống không idempotent | Không tăng timeout vô điều kiện hoặc tạo job trùng |
| HTTP `429`, quota/rate limited | Đọc `Retry-After`, cooldown tới thời điểm hợp lệ, thử resource khác có quyền | Không đổi account, token hoặc phát sinh chi phí |
| Không có resource/reviewer | `WAITING_RESOURCE`, nhả không cần thiết, ghi `next_attempt_at` | Không lấy implementer làm independent reviewer |
| `DENY_CONTROL_PLANE_MUTATION`, secrets, device/Production, security | HARD BLOCK, Owner scoped authorization riêng nếu thực sự cần | Không vô hiệu guard, không biến denial thành retry tự động vô hạn |
| sourceRevision/head stale, checklist thay đổi | FAIL CLOSED, đối soát current Parent, tạo revision mới theo idempotency gate; báo stale evidence | Không merge PR stale, không đóng issue |

**Budget mẫu để QA:** 1 initial + tối đa 2 lần đổi model cho từng failure signature; tối đa 3 sửa CI/review có giới hạn như mã hiện hành. Con số này là đề xuất kiểm thử, **không tự ý đổi runtime retry policy**. Khi hết budget chuyển `BLOCKED_FINAL`, nhả lease và tiếp tục job độc lập; chỉ rearm nếu revision thay đổi hoặc có bằng chứng recovery mới theo chính sách.

## A06 — QA, Child ACCEPTED, Parent DONE

1. **Child RESULT:** có `task_id`, `parent_id`, `source_revision`, `employee_id`, `resource_id`, `lease_epoch`, `started_at`, `finished_at`, `artifact_url`, `result_hash`. Chỉ lưu bằng chứng thật, không dựng timestamps.
2. **Coding proof:** PR đúng repo/nhánh, tập file nằm trong scope, exact head SHA; CI + Queue Hygiene + Vercel khi bắt buộc phải PASS **trên đúng head**; không dùng PASS của SHA cũ.
3. **Review độc lập:** reviewer khác implementer, xem đúng head cuối cùng, có review quyết định + biên nhận URL; review stale hoặc self-review không pass. Waiver riêng của Owner nếu chính sách cho phép phải ghi rõ `WAIVED_NOT_INDEPENDENT_PASS`, **không** giả thành independent reviewer approval.
4. **Merge/release gate:** không tự merge khi branch protection/owner release chưa đủ; chỉ merge với expected head và cổng hiện hành. Production, thiết bị, security không nằm trong quyền mặc định của Stage A.
5. **Child ACCEPTED:** kết quả đúng task spec + tất cả test và review applicable + verified receipt + current source revision + live acceptance nếu task đòi.
6. **Parent DONE:** toàn bộ **required** child đã `ACCEPTED`, current Parent revision khớp, cổng nghiệm thu Parent đạt, không còn active writer và có finish receipt; trong một transaction cập nhật Parent + event `PARENT_ACCEPTED`. Chỉ lúc đó reconcile mới có thể đóng GitHub Issue.
7. **Luồng hậu nghiệm thu:** release resource lease bằng token, phát `CHILD_ACCEPTED/PARENT_DONE`, cập nhật UI Work Center bằng snapshot DB/GitHub, sau đó scheduler tự lấy tiếp job eligible; *không* tự chuyển `DONE` từ checkbox markdown hay `HTTP 200` của AI.

**Guard trước khi sửa mã ở giai đoạn sau:** cần regression chứng minh Coding Intake không gọi `close(issue)` chỉ vì một Coding objective hoàn tất trong Parent có nhiều child/ `KEEP_OPEN_ON_STEP_COMPLETE=true`. Kết thúc một **Stage A** tài liệu và kết thúc **S1–S6** của GH-280 là hai sự kiện khác nhau.

## A07 — Test plan / các cổng nghiệm thu theo thứ tự

Các bài sau là **kịch bản phải triển khai ở giai đoạn mã được ủy quyền**, chưa phải testcase đã chạy:

| ID | Thiết lập (fixtures / fault injection) | Kết quả bắt buộc |
| --- | --- | --- |
| T01 Manager isolation | 3 Parent READY, Manager A treo timeout 240s, B/C trả job hợp lệ ngay | Worker scheduler claim B/C trong ngân sách ngắn; A vẫn timeout mà không block dispatch B/C |
| T02 Concurrency | 3 Child khác nhau về write paths/scopes + 3 resource khác nhau có functional evidence | Có 3 `RUNNING` đồng thời, 3 lease/token riêng; đối chiếu timestamps overlap |
| T03 Conflict | 2 Child viết cùng `tests/example.test.mjs` hoặc cùng resource scope | Tối đa 1 writer RUNNING; Child thứ hai WAITING không có mutation |
| T04 Same AI | 2 Child khác file nhưng chỉ 1 eligible `resource_id` | Không cùng chiếm lease; resource giải phóng và job 2 tiếp tục |
| T05 Stale result/fencing | A timeout lease, B recover, A phản hồi muộn | A rejected (epoch cũ), không đổi DB/status/PR mới |
| T06 Output repair | Provider lần 1 JSON lỗi, lần 2 đúng schema, 1 provider 429 | Retry/failover trong budget và rate-limit-aware; không gọi 429 loop |
| T07 Hard deny | Manager đề xuất path control-plane trái scope hoặc device action chưa được phép | `BLOCKED` có reason, không write protected |
| T08 Premature close | Parent 8 children, chỉ Child 1 có merged PR/CI/review; Coding objective completed | Parent OPEN, 1/8 accepted; GitHub issue không bị đóng |
| T09 Parent completion | 8/8 accepted với exact-head proofs và finish receipt | Parent DONE atomically, đúng 1 GitHub close, event unique |
| T10 Restart/recovery | Restart Core/Coding khi một job RUNNING, một job WAITING_CI | Không trùng claim/PR, không reuse expired lease; tự tiếp tục từ journal |
| T11 Next job | 2 jobs đạt DONE, còn Child NEXT độc lập trong queue | Tự nhận NEXT trong SLA được cấu hình và có event/lease/jobId |
| T12 Scope/priority | P0 Owner-held + P1 code safe + P2 mobile chưa có hardware gate | P0 và mobile fail-closed, P1 độc lập tiếp tục; không tăng quyền để đạt concurrency |

**Đầu ra test dự kiến:** báo cáo `test_id, fixture_sha, source_sha, timestamps, task_id, lease_token_hash, observed_states, expected_states, result, evidence_url`; test không chạy = `NOT_RUN`, không phải PASS.

### Lệnh kiểm thử dự kiến (không phải đã chạy)

- Node unit suite liên quan đến `tests/coding-lane-foundation.test.mjs`, `tests/github-coding-intake.test.mjs`, `tests/work-order-lifecycle-v2.test.mjs` nếu hiện hữu; kiểm tra đường dẫn trước khi gọi.
- Harness concurrency Postgres chạy tối thiểu T01–T05 và T08–T11 trong sandbox có chủ sở hữu lease hợp lệ, không được chạy trực tiếp Production.
- CI/head/review đối chiếu GitHub API, không lấy kết quả một run tương tự từ PR khác.
- Live PC01 và NV102 chỉ kiểm tra khi đã được cấp action-specific authorization của thiết bị/runtime.

## A08 — Quy trình phân đợt và điều kiện hoàn thành

**Chỉ Stage A / GH-4700** có thể đóng sau khi:
- [ ] PR **chỉ tài liệu** thuộc `docs/implementation/`, không đụng protected area.
- [ ] A01–A07 có đầy đủ trong tài liệu, đối chiếu source hiện hành.
- [ ] Required CI/exact-head gates của PR PASS.
- [ ] Có reviewer độc lập đã APPROVE trên **đúng final SHA**, hoặc có quyết định Owner waiver hợp lệ mà chính sách **cho phép**; waiver không phải independent QA pass.
- [ ] GitHub merge qua PR với expected SHA và source document trên main, không trực tiếp ghi main.
- [ ] Bằng chứng PR/run/reviewer/merge được ghi về GH-4700; đánh dấu 8/8 chỉ với receipt từng mốc; nếu thiếu thì **BLOCKED/WAITING**.

**Ngoài Stage A:** S2 phục hồi provider, S3 sửa Scheduler control-plane, S4 DAG/lease, S5 unified DONE, S6 E2E vẫn là mục tiêu của [GH-280](https://github.com/newsdayads/tigeriq-ai-lab/issues/280). Mọi mã dưới `apps/tigeriq-core/` hoặc `apps/tigeriq-coding-lane/` yêu cầu một Work Order và đúng cổng ủy quyền riêng; không lấy tài liệu này làm giấy phép viết mã protected.

## Bàn giao kỹ thuật cho giai đoạn mã (chưa được ủy quyền trong GH-4700)

1. **Patch nhóm S3**: `managerTick` → bounded async manager dispatcher, worker dispatcher không đợi Manager; bổ sung backpressure + metrics.
2. **Patch nhóm S4**: schema Parent/Child DAG, claim nguyên tử, conflict overlap/fencing; migration reversible + test PostgreSQL.
3. **Patch nhóm S5**: hợp nhất nghiệm thu từ Core/Coding; chống premature close, stale SHA; audit receipts, independent QA.
4. **Patch nhóm S2** (có thể độc lập): provider adapters/JSON response/timeouts, với API Doctor evidence và retry budget; giữ nguyên cost/auth gates.
5. **E2E S6**: chứng minh 3 công việc độc lập đồng thời, 2 công việc DONE đúng chuẩn, NEXT auto-claim; không tính repo docs hay API probe là tác vụ ứng dụng đã nghiệm thu.

**Kết luận Stage A:** Thiết kế có thể được review/merge trong phạm vi tài liệu hiện hành; **không có** chứng cứ Scheduler production đã được sửa, 3 jobs chạy song song hay toàn TigerIQ tự hoàn tất công việc.
