# P0 G3 — Bằng chứng Skill và năng lực AI trên nhánh riêng

> Hiện hành vòng 3: G3 92/92 và kiểm thử nguồn tương thích 129/129 đạt. Canary mô hình thật vẫn BLOCKED; không gọi mô hình. Phần VÒNG 3 ở cuối ghi nguồn mới, biên nhận và giao thức bàn giao GitHub. Các mục vòng 1/2 là lịch sử theo SHA ghi kèm.

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


## VÒNG 2 — CANARY MODEL/CÔNG CỤ, CHƯA NGHIỆM THU

Thời điểm: 2026-10-16T01:20:46.944212+00:00.

- Lệnh Owner hiện hành: chỉ G3, tiếp tục nhánh `p0/4902-g3-work` và PR nháp #4911, không PR mới, không sửa PC01 hoặc ghi nhánh Vy.
- Đã nạp lại GitHub main `a3084ed58f532087e3c83e38deb5b926d7894448`, Issue #504 (89 bình luận), #4902 (9 bình luận), PR #4898 HEAD `256f350f808f64747d47e66ca1ba759cfd0e584a`, PR #4911 HEAD `2379f9783330d28ee6159b4ffff8090467785c0f`. Hai PR còn nháp/chưa hợp nhất.
- Vy đã rà soát nguồn vòng 1 bằng COMMENT: https://github.com/newsdayads/tigeriq-ai-lab/pull/4911#pullrequestreview-5541779980. Không biến COMMENT thành phê duyệt hợp nhất hoặc nghiệm thu năng lực model.

### Quyết định từ kiểm tra điều kiện thật

`STATE=BLOCKED`
`BLOCKER=CODING_CANARY_RUNTIME_ADAPTER_UNAVAILABLE`
`MODEL_CAPABILITY_VERIFIED=false`
`MODEL_ID=null`
`MODEL_RESPONSE=null`
`NEW_MODEL_CALLS=0`

Phạm vi kết luận: phiên Work hiện tại chưa có bộ kết nối host được xác minh gồm `inspect/invokeModel/runTool/verifyReceipt`, định danh model lập trình và bằng chứng quyền/chi phí bằng 0. Không suy ra mọi tài nguyên TigerIQ đều thiếu hoặc PC01 không có model.

- Kiểm tra công cụ hiện hữu không thấy công cụ gọi model lập trình; có Weave nhưng mô tả công cụ xác nhận tiêu credits, không đáp ứng lệnh không phát sinh phí mới. Không gọi công cụ tiêu credits.
- Trên máy kiểm thử, `codex`, `claude`, `ollama`, `gemini` không có trong PATH. Đã kiểm tra tên biến môi trường liên quan model, không đọc hoặc ghi giá trị bí mật; không có biến định danh/quyền gọi model được xác minh.
- Đã dùng kỹ năng quản lý kết nối và tìm plugin theo `Ollama model inference`. Không thấy bộ gọi model lập trình phù hợp đang cài/kết nối; kết quả Hugging Face chỉ mô tả tra cứu model/dataset và chưa cài. Không tự cài plugin, tạo credential hay chọn dịch vụ trả phí.
- Không dùng RDC/PC01, tài khoản trình duyệt hoặc dịch vụ khác làm đường vòng. Không tự coi định danh của trợ lý hiện tại là bằng chứng model từ nhà cung cấp.

Công cụ thật đã kiểm tra độc lập với phép thử model: `functions.exec_command`, Node `v24.19.0`, Linux, mã thoát 0. Biên nhận công cụ `chunk_id=3acf7f`:

```json
{"probe_id":"GH-4902-G3-ROUND2-TOOL-PROBE","tool":"functions.exec_command","node":"v24.19.0","platform":"linux","sha256":"5eed1e29a0b9b5da43f66312196584fec128f6c984d7f93ba109fe692100c6f4","exit_expected":0}
```

Đây chỉ chứng minh công cụ Node chạy được câu lệnh được phép, **không** chứng minh model đã gọi công cụ hoặc làm xong bước kỹ thuật. Quyền chạy câu lệnh Node đã biết không tự chứng minh có hộp cách ly an toàn để chạy mã model chưa tin cậy.

### Hợp đồng phép thử một bước

`runCodingSkillCapabilityCanary` dùng Skill ACTIVE thật, ghim source SHA, sinh run ID mới và câu lệnh có hàm băm. Bước `G3_MODEL_TOOL_01`: model triển khai duy nhất hàm thuần `normalizePort`; công cụ cách ly độc lập chạy 19 trường hợp đầu vào, đối chiếu đầu ra thực thay vì tin nhãn PASS.

Điều kiện trước khi gọi model: kết nối/model/tool khả dụng, quyền có biên nhận, xác minh từ host tin cậy, nguồn chỉ đọc, hộp cách ly thật và cả model/tool có chi phí tăng thêm đúng 0. Thiếu bất kỳ điều kiện nào thì BLOCKED trước khi gọi. Các callback host phải thuộc bề mặt kết nối thật, không được lấy từ phản hồi AI hoặc JSON. Đây là hợp đồng G3 nguồn, không cấp quyền và chưa được nối vào Coding Lane chính.

Biên nhận model ràng buộc run ID, model ID, source SHA, prompt SHA-256, phản hồi nguyên văn và hash. Phản hồi phải chỉ có một bước, source và context hash đúng. Biên nhận công cụ ràng buộc tool ID, biên nhận model, source SHA, hash mã/input/stdout, mã thoát và 19 đầu ra đúng. Host phải xác minh độc lập tính xác thực của từng biên nhận; kiểm tra cấu trúc JSON không thay thế xác thực nhà cung cấp.

Dữ liệu `test-fixture` chỉ được trả `FIXTURE_VALIDATED`, `capability_verified=false`; không được nâng thành bằng chứng model thật. Module không eval/VM/shell hoặc tự tìm endpoint/secret.

### Biên nhận kiểm tra điều kiện thật

Source SHA dưới đây là HEAD GitHub đã đọc trước phép thử, không phải tuyên bố mã vòng 2 đã được cài trên SHA đó. Mã chính sách vòng 2 được ghim bằng SHA-256 ở bảng dưới và commit cuối của PR.

```json
{
  "schema": "TIGERIQ_G3_CAPABILITY_CANARY_V1",
  "run_id": "11d21fb1-493d-4cac-812f-e8d2f93becd2",
  "step_id": "G3_MODEL_TOOL_01",
  "started_at": "2026-10-16T01:20:46.828Z",
  "source_sha": "2379f9783330d28ee6159b4ffff8090467785c0f",
  "status": "BLOCKED",
  "capability_verified": false,
  "model_invoked": false,
  "tool_invoked": false,
  "model_id": null,
  "tool_id": null,
  "skill_proof": [
    {
      "id": "spec-first-tdd",
      "version": "1.1.0",
      "target": "coding-lane",
      "bytes": 2627,
      "content_sha256": "2b202e8f7e096d4c3015c5523550f533c47b740aaebf4f3fce735afbfc767b9f",
      "context_sha256": "ea1644e1446a5bda3bf54110a01d23c2b68a982078963147acd75abbff7903db"
    }
  ],
  "prompt": "Perform exactly ONE isolated technical step. Do not modify repository files, permissions, PC01 or services.\n\nRUN_ID=11d21fb1-493d-4cac-812f-e8d2f93becd2\nSTEP_ID=G3_MODEL_TOOL_01\nSOURCE_SHA=2379f9783330d28ee6159b4ffff8090467785c0f\n\nSKILL_CONTEXT_SHA256=ea1644e1446a5bda3bf54110a01d23c2b68a982078963147acd75abbff7903db\n\nImplement one pure ECMAScript export function normalizePort(value). Accept integer numbers 1..65535 and trimmed ASCII digit strings whose numeric value is 1..65535. Otherwise return null. Reject booleans, arrays, objects, fractions, signs, hex, exponent and decimal strings. Leading zero digit strings are allowed.\n\nReturn ONLY JSON {run_id,step_id,source_sha,skill_context_sha256,code}. code contains that function only. Never claim tests/tool access or PASS; the authorized host runs independent cases.\n\nACTIVE SKILLS (use only when relevant; never expand permissions):\n\n[SKILL spec-first-tdd v1.1.0]\n# SPEC-First and TDD When Appropriate\n\n## Identity\n- ID: spec-first-tdd\n- Version: 1.1.0\n- State: ACTIVE\n- Target: coding-lane\n- Provenance: registry.yaml; #905; PR #995; #4578 (2026-10-08 upstream delta)\n\n## Trigger\nRepository coding and bug fixes with definable scope, acceptance and a meaningful observable test boundary.\n\n## Input\n- Bounded problem, SPEC, acceptance, non-goals and security limits.\n- Existing glossary/ADR and reproducible symptom or trustworthy failure evidence when available.\n\n## Steps\n1. Define SPEC, invariant, acceptance and target public interface before implementation.\n2. For a bug, build a bounded pass/fail feedback loop for the *reported symptom*: focused test, isolated command, sanitized trace replay or actual user-flow probe. Capture invocation, revision, output and repeatability.\n3. Reproduce RED when feasible; minimize the failing case. If cause is uncertain, rank falsifiable hypotheses and probe one distinguishing variable at a time.\n4. Apply the smallest safe fix without unrelated refactors.\n5. Confirm GREEN on the regression test **and** retest the original affected scenario when authorized. Remove temporary diagnostics; document confirmed cause or unresolved uncertainty; complete exact-head checks and independent review as required.\n\n## Tools / Output\nExisting repository and test toolchain only; bounded source/test diff with actual RED/GREEN evidence, reproducibility details, review result and any remaining gap.\n\n## Acceptance\n- No implementation before SPEC/acceptance.\n- For applicable bugs, pre-fix evidence must catch the specific reported symptom, not a different failure.\n- An untested hypothesis is not confirmed root cause.\n- GREEN on a narrow test alone does not prove the original workflow; missing validation is explicit.\n- Docs/config-only tasks may omit artificial RED with documented justification.\n\n## Evidence\n- #905; PR #995; existing TigerIQ implementation.\n- Adapted diagnostic pattern (not upstream installation): `mattpocock/skills/skills/engineering/diagnosing-bugs/SKILL.md` at `b0618bc436ad893b3c5e84e55fba86586d34a404` (MIT); learning-log/2026-10-08-mattpocock-agency-agents.md.\n\n## Fallback\nIf RED is not meaningful or reproducible, report attempts and exact missing evidence; use the narrowest authorized alternative. Never invent a failing test, confirmed cause or PASS.\n\n## Safety\nNo direct main write, deployment, paid/credential/security/destructive change, new permission, Codex, RDC or App Chrome mutation.\n\n## Non-goals\nNo fake test for non-testable work, wholesale TDD replacement, architecture redesign, or duplicate debugging skill.\n\n\nEND ACTIVE SKILLS",
  "prompt_sha256": "bdaada7d8c0d8a6386ebcd1bc89a06c2527561032e29b12f7bdea2accbef1fb3",
  "response": null,
  "response_sha256": null,
  "model_receipt": null,
  "tool_receipt": null,
  "permission_receipts": null,
  "code": "CODING_CANARY_RUNTIME_ADAPTER_UNAVAILABLE",
  "finished_at": "2026-10-16T01:20:46.829Z"
}
```

Không có model ID, phản hồi hay biên nhận kỹ thuật thật để điền; giữ null/false đúng sự thật. Câu lệnh đầy đủ đã được chuẩn bị và lưu nguyên văn, chưa gửi đến model.

### Kiểm thử và tệp vòng 2

| Tệp | Byte | SHA-256 |
| --- | ---: | --- |
| `apps/tigeriq-coding-lane/coding-skill-policy.mjs` | 14025 | `9bd31146ccf4a6da0c81a284d2cc428d1bc26f5aea3a5cbbdc35e799d9563914` |
| `tests/coding-skill-policy.test.mjs` | 24412 | `58a958924c47b00cf73975c22b47a3164087b07c448a78a906c5c2b6050809eb` |
| `docs/skills/frontend-engineering/SKILL.md` | 3108 | `74428c3216cb047062a5f61d0230293a1a54e805a61756515d801859159aa47c` |
| `docs/skills/backend-engineering/SKILL.md` | 3125 | `b9f62b4398f3a576ccf48375ba99b12a9a40e39104d790d05271b94947624657` |

- `node --check apps/tigeriq-coding-lane/coding-skill-policy.mjs`: mã thoát 0.
- `node --test tests/coding-skill-policy.test.mjs tests/coding-step-contract.test.mjs tests/coding-p0-isolated-contract-journey.test.mjs`: **127/127 đạt**, 0 lỗi, 0 bỏ qua; Node v24.19.0. Gồm 92 bài G3 và 35 bài hợp đồng/hành trình hiện hữu.
- Kiểm thử âm: model/tool/ID không có, không khả dụng hoặc quyền bị từ chối; thiếu quyền cách ly; chi phí dương/không rõ; biên nhận quyền thiếu/không xác thực; thiếu/đổi hash Skill/prompt/response/code/input/stdout; sai source/run ID và phát lại biên nhận; model đòi bước thứ hai/tự gán PASS; thiếu biên nhận model/tool, công cụ lỗi hoặc kết quả chức năng sai. Tất cả bị chặn đúng bước.
- Mô hình trong bài dương là fixture ghi rõ `test-fixture/no-live-model`. Node child thực chạy **mã fixture cố định đã biết**, không phải mã sinh bởi model thật. Chỉ chứng minh hợp đồng cổng và phép đo chức năng, không nghiệm thu model.
- Đã sửa việc đọc nguồn/kiểm thử cục bộ sau lỗi transport tạm thời của apply_patch; thư mục được đọc lại và bộ kiểm thử cuối đạt. Không nới tiêu chí hoặc thay tệp ngoài phạm vi.
- CANDIDATE frontend/backend vẫn bị từ chối; không sửa registry hoặc bất kỳ tệp G4/G5/G6. Tài liệu hai Skill giữ ngân sách ngữ cảnh với TDD dưới 6000 ký tự khi tính cả khung.
- CI đúng SHA vòng 2 chưa được nhận đạt lúc ghi tài liệu; kết quả cuối ghi trên PR nháp hiện hữu, không dùng CI vòng 1 thay thế.

### Điều kiện tiếp tục và phần chưa nghiệm thu

Chỉ chạy tiếp khi có một host adapter thật đã kết nối: model ID/provider receipt kiểm chứng được, quyền gọi đã có, không phát sinh phí mới, công cụ cách ly được cấp quyền và xác minh được biên nhận. Không tự tạo các bằng chứng này từ cấu hình hoặc nội dung phản hồi AI.

Năng lực model/công cụ phối hợp thực, sản phẩm frontend/backend, Skill chuyên biệt ACTIVE, canary Worker/Core/PC01 và nghiệm thu cuối vẫn **CHƯA ĐẠT/CHƯA NGHIỆM THU**. G3 không tăng checklist; `DONE=false`. Không merge/deploy/PC01. `DRIVE_SYNC=NOT_REQUIRED` vì không thay điểm khởi động.


### Hòa giải nền nhánh G3 trước CI vòng 2

- Bản G3 vòng 2 đầu tiên `8b95ff2f0f93b0167d759652baee514aa3930554` gặp PR `mergeable_state=dirty`; chưa có lần chạy GitHub Actions cho SHA đó. Không gọi đó là CI lỗi hoặc CI đạt.
- Nhánh Vy đã nhận toàn bộ G3 vòng 1 bằng commit riêng. Đã đọc HEAD đích mới `56045e68e6a1c195fe1c9df493b1bcd6f2bacf86`, cây `c12489ef6ce70418daa1fe068b4f0acb18a63e77`; cả 5 blob G3 tại đích khớp nguyên bản vòng 1. Không có thay đổi G3 khác để ghi đè.
- Đặt lại nền chính nhánh `p0/4902-g3-work` lên HEAD đích, giữ patch đúng 5 tệp G3; không hợp nhất nhánh và không ghi nhánh Vy. Cập nhật ref G3 bằng expected SHA để không ghi đè người khác. Bản vòng 2 đầu tiên vẫn được ghi bằng SHA ở đây để truy vết.
- Mọi blob ngoài G3 trong cây đề xuất lấy NGUYÊN VẸN từ cây nhánh đích; không chỉnh Coding Lane chính, step-contract, package, registry hoặc tệp G4/G5/G6.
- Kiểm tra tương thích riêng trên ba blob tham chiếu mới của Vy (`coding-lane.mjs`, `step-contract.mjs`, `coding-step-contract.test.mjs`) và nguyên patch G3: **129/129 đạt**, 0 lỗi/0 bỏ qua. Gồm 92 bài G3 và 37 hợp đồng/hành trình. Đây là kiểm thử nguồn, không nghiệm thu model thật.
- Tiếp tục cùng PR nháp #4911, không tạo PR khác. CI phải lấy SHA mới sau hòa giải; trạng thái canary vẫn BLOCKED như biên nhận trên.


### CI vòng 2 — lỗi ngoài G3 và phụ thuộc mới

- CI tại `722459182583446ffad62a239132a649908ba044` FAIL: https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38835215246/job/116762705918 . G3 **92/92 bài đạt trong nhật ký CI**; công đoạn tổng thể lỗi sau đó tại bài PostgreSQL G4.
- Lỗi thật: `EACCES: permission denied, stat tests/coding-postgres-integration.test.mjs`; lệnh G4 chạy bằng `sudo -n -u postgres`, stack ở `tests/run-postgres-isolated-ci.mjs:14,23`. Không sửa hai tệp này trong G3.
- Kiểm tra nguồn đích mới: `bf12476bdd9257fb78dfae5ca5cf78725b944fd4` đã có bản sửa G4 chạy bài thử bằng tài khoản checkout thay vì postgres. Đây là phụ thuộc đã đổi có ý nghĩa; không chạy lại cùng mã/lỗi cũ.
- Đã xác minh cả 5 blob G3 của nhánh Vy vẫn khớp vòng 1. Đặt lại nền G3 lên SHA mới này, giữ nguyên toàn bộ blob ngoài G3 từ nhánh Vy. Chỉ 5 tệp G3 có patch; không ghi nhánh Vy hoặc hợp nhất nhánh.
- CI cuối phải đối chiếu SHA sau lần đặt lại nền này. Bằng chứng G3 không biến lỗi CI ngoài phạm vi thành PASS; trạng thái canary mô hình thật vẫn BLOCKED.


## VÒNG 3 — KIỂM TRA NGUỒN MỚI VÀ BÀN GIAO TỰ ĐỘNG

Thời điểm kiểm tra: 2026-10-16T03:26:33.364287+00:00.

### Nguồn và phân quyền

- Main: `3de228884b8bb42647155e1a41d91f8a6f2eff87`; Loader `bootstrap/00_TIGERIQ_LOADER.md`, blob `73288544c4e53f289958fdbf426e470352f040e1`, không đổi điểm khởi động.
- Đã đọc lại AGENTS.md, Issue #504 và 89 bình luận, Issue #4902 và 13 bình luận; giao thức bàn giao mới: https://github.com/newsdayads/tigeriq-ai-lab/issues/4902#issuecomment-6207222112 .
- PR #4898 / Vy: `2d9197bc2d47be920b96eba7eb256a657da389c4`. CI/Queue/Vercel đều success đúng SHA; G4 PostgreSQL cách ly đã được Vy nghiệm thu. Không chạy lại nhiệm vụ G4 hoặc tăng checklist.
- PR #4911 / G3 đầu lượt: `5bd8d276ec8c96354868134596081b4190f6a657`; CI trước lỗi G6 `CODING_PRODUCT_GATE_DEPENDENCY_MISSING`, G3 92/92 vẫn đạt. Không gán lỗi đó cho Skill hoặc coi CI cũ là kết quả HEAD mới.
- PR #4912 / Antigravity: `fd50aa2647dce7a26924de58b974f14af0a19d7e`, CI success nhưng G5 chưa nghiệm thu theo Issue #4902 do provenance/receipt còn vướng; không sao chép hoặc sửa G5.
- Cả ba PR vẫn NHÁP/OPEN/NOT_MERGED. Nguồn #4902 hiện nghiệm thu G1/G2/G4 = 3/6; G3/G5/G6 chưa đạt. Không tự đổi trạng thái đó.

Chỉ dùng 5 tệp G3 đã phân quyền. Không thấy lỗi G3 mới qua rà soát và thử nghiệm; giữ NGUYÊN policy, 92 bài kiểm thử và hai Skill ứng viên so với HEAD G3 đầu lượt, chỉ bổ sung tài liệu bằng chứng. Đặt lại nền chính nhánh G3 lên HEAD Vy mới để thử tương thích; mọi blob ngoài G3 lấy nguyên vẹn từ cây nhánh Vy, không ghi nhánh Vy/Antigravity.

| Tệp mã giữ nguyên | SHA-256 |
| --- | --- |
| `apps/tigeriq-coding-lane/coding-skill-policy.mjs` | `9bd31146ccf4a6da0c81a284d2cc428d1bc26f5aea3a5cbbdc35e799d9563914` |
| `tests/coding-skill-policy.test.mjs` | `58a958924c47b00cf73975c22b47a3164087b07c448a78a906c5c2b6050809eb` |

### Xác minh adapter hiện hành

- Không có công cụ gọi mô hình lập trình trong công cụ phiên hiện tại; Weave công bố tiêu credits, không gọi vì không đáp ứng chi phí tăng thêm bằng 0.
- Kiểm tra lại PATH: không có `codex`, `claude`, `ollama`, `gemini`. Chỉ kiểm tra TÊN biến môi trường model; không có tên cấu hình API/model phù hợp và không đọc giá trị bí mật.
- Đã đọc adapter canonical `apps/tigeriq-core/ollama-probe-adapter.mjs` tại main mới. Đây là bộ chuyển phép dò prefix `TIGERIQ_RESOURCE_PROBE_`, giới hạn 32 token và không cung cấp quyền/cách ly/biên nhận kỹ thuật G3. Nguồn hợp đồng `nv-inference-contract.mjs` cũng không tự cấp quyền gọi.
- Đọc chỉ trạng thái Ollama tại địa chỉ localhost đúng trong mã nguồn: `curl --noproxy '*' --max-time 2 --silent --show-error http://127.0.0.1:11434/api/tags`. Kết quả mã thoát 7, không kết nối được; không gửi câu lệnh suy luận hoặc truy cập PC01.
- So sánh cây G3 và HEAD Vy mới: không có adapter/inference mới hoặc blob thay đổi tạo đường thực thi hợp lệ cho phiên Work.
- Có biên nhận công cụ Node thật: `functions.exec_command`, Node v24.19.0, chunk `14480b`, probe `G3_R3_NODE_PROBE`, SHA-256 `49f21f1bc3fe18faca590f20a3441e13fc1680f2f389841324aa7fa639727b47`. Nó không chứng minh mô hình đã gọi công cụ, hoặc có hộp cách ly cho mã mô hình không tin cậy.

Kết luận chỉ cho bề mặt Work đã kiểm tra: `CODING_CANARY_RUNTIME_ADAPTER_UNAVAILABLE`. Không suy ra mọi mô hình TigerIQ đều không hoạt động. Không cài thêm công cụ, lấy secret, gọi API tính phí, tự khai quyền hoặc đổi CANDIDATE thành ACTIVE.

### Biên nhận kiểm tra điều kiện mới — không giả canary đạt

Đây là phép kiểm tra trên chính blob G3 không đổi, source SHA là HEAD đọc tại đầu lượt. Nguồn cuối sau cập nhật tài liệu/nền nhánh được ghi trên PR và bình luận bàn giao; không giả rằng SHA tự tham chiếu đã tồn tại trước phép thử.

```json
{
  "schema": "TIGERIQ_G3_CAPABILITY_CANARY_V1",
  "run_id": "365d5340-bbc8-4911-8b34-8ab6cdaa67b2",
  "step_id": "G3_MODEL_TOOL_01",
  "started_at": "2026-10-16T03:25:27.052Z",
  "source_sha": "5bd8d276ec8c96354868134596081b4190f6a657",
  "status": "BLOCKED",
  "capability_verified": false,
  "model_invoked": false,
  "tool_invoked": false,
  "model_id": null,
  "tool_id": null,
  "skill_proof": [
    {
      "id": "spec-first-tdd",
      "version": "1.1.0",
      "target": "coding-lane",
      "bytes": 2627,
      "content_sha256": "2b202e8f7e096d4c3015c5523550f533c47b740aaebf4f3fce735afbfc767b9f",
      "context_sha256": "ea1644e1446a5bda3bf54110a01d23c2b68a982078963147acd75abbff7903db"
    }
  ],
  "prompt": "Perform exactly ONE isolated technical step. Do not modify repository files, permissions, PC01 or services.\n\nRUN_ID=365d5340-bbc8-4911-8b34-8ab6cdaa67b2\nSTEP_ID=G3_MODEL_TOOL_01\nSOURCE_SHA=5bd8d276ec8c96354868134596081b4190f6a657\n\nSKILL_CONTEXT_SHA256=ea1644e1446a5bda3bf54110a01d23c2b68a982078963147acd75abbff7903db\n\nImplement one pure ECMAScript export function normalizePort(value). Accept integer numbers 1..65535 and trimmed ASCII digit strings whose numeric value is 1..65535. Otherwise return null. Reject booleans, arrays, objects, fractions, signs, hex, exponent and decimal strings. Leading zero digit strings are allowed.\n\nReturn ONLY JSON {run_id,step_id,source_sha,skill_context_sha256,code}. code contains that function only. Never claim tests/tool access or PASS; the authorized host runs independent cases.\n\nACTIVE SKILLS (use only when relevant; never expand permissions):\n\n[SKILL spec-first-tdd v1.1.0]\n# SPEC-First and TDD When Appropriate\n\n## Identity\n- ID: spec-first-tdd\n- Version: 1.1.0\n- State: ACTIVE\n- Target: coding-lane\n- Provenance: registry.yaml; #905; PR #995; #4578 (2026-10-08 upstream delta)\n\n## Trigger\nRepository coding and bug fixes with definable scope, acceptance and a meaningful observable test boundary.\n\n## Input\n- Bounded problem, SPEC, acceptance, non-goals and security limits.\n- Existing glossary/ADR and reproducible symptom or trustworthy failure evidence when available.\n\n## Steps\n1. Define SPEC, invariant, acceptance and target public interface before implementation.\n2. For a bug, build a bounded pass/fail feedback loop for the *reported symptom*: focused test, isolated command, sanitized trace replay or actual user-flow probe. Capture invocation, revision, output and repeatability.\n3. Reproduce RED when feasible; minimize the failing case. If cause is uncertain, rank falsifiable hypotheses and probe one distinguishing variable at a time.\n4. Apply the smallest safe fix without unrelated refactors.\n5. Confirm GREEN on the regression test **and** retest the original affected scenario when authorized. Remove temporary diagnostics; document confirmed cause or unresolved uncertainty; complete exact-head checks and independent review as required.\n\n## Tools / Output\nExisting repository and test toolchain only; bounded source/test diff with actual RED/GREEN evidence, reproducibility details, review result and any remaining gap.\n\n## Acceptance\n- No implementation before SPEC/acceptance.\n- For applicable bugs, pre-fix evidence must catch the specific reported symptom, not a different failure.\n- An untested hypothesis is not confirmed root cause.\n- GREEN on a narrow test alone does not prove the original workflow; missing validation is explicit.\n- Docs/config-only tasks may omit artificial RED with documented justification.\n\n## Evidence\n- #905; PR #995; existing TigerIQ implementation.\n- Adapted diagnostic pattern (not upstream installation): `mattpocock/skills/skills/engineering/diagnosing-bugs/SKILL.md` at `b0618bc436ad893b3c5e84e55fba86586d34a404` (MIT); learning-log/2026-10-08-mattpocock-agency-agents.md.\n\n## Fallback\nIf RED is not meaningful or reproducible, report attempts and exact missing evidence; use the narrowest authorized alternative. Never invent a failing test, confirmed cause or PASS.\n\n## Safety\nNo direct main write, deployment, paid/credential/security/destructive change, new permission, Codex, RDC or App Chrome mutation.\n\n## Non-goals\nNo fake test for non-testable work, wholesale TDD replacement, architecture redesign, or duplicate debugging skill.\n\n\nEND ACTIVE SKILLS",
  "prompt_sha256": "bd7663c578bd7e0e4412ffbcf1ec90c5c4674428e6ad4d9a1ec27e7ece4f3a38",
  "response": null,
  "response_sha256": null,
  "model_receipt": null,
  "tool_receipt": null,
  "permission_receipts": null,
  "code": "CODING_CANARY_RUNTIME_ADAPTER_UNAVAILABLE",
  "finished_at": "2026-10-16T03:25:27.054Z"
}
```

Model/tool ID trong phép thử phối hợp, phản hồi và quyền vẫn null, `model_invoked=false`, `tool_invoked=false`, `capability_verified=false`. Câu lệnh đầy đủ đã lưu nhưng chưa gửi đến mô hình. Skill TDD ACTIVE 1.1.0 có byte/hash thật; frontend/backend vẫn CANDIDATE 0.1.0 và bị từ chối.

### Kiểm thử và tương thích

- `node --check apps/tigeriq-coding-lane/coding-skill-policy.mjs`: đạt.
- `node --test tests/coding-skill-policy.test.mjs`: **92/92 đạt**, 0 lỗi, không bỏ qua; không sửa hoặc bỏ bài nào.
- `node --test tests/coding-skill-policy.test.mjs tests/coding-step-contract.test.mjs tests/coding-p0-isolated-contract-journey.test.mjs` trên các blob tham chiếu đúng HEAD Vy `2d9197bc...`: **129/129 đạt**, 0 lỗi/0 bỏ qua.
- Lần thử thêm tệp G6 trong bản sao thưa cục bộ bị `ERR_MODULE_NOT_FOUND` do chưa tải toàn bộ dependency `manager-json.mjs` của Coding Lane; đây là thiếu dependency của thư mục thử, không phải lỗi G3 hoặc kết luận G6 nguồn hỏng. Không sửa G6/harness để làm xanh. CI đầy đủ trên HEAD cuối có toàn repository sẽ kiểm tra phần này đúng môi trường.
- 92 bài G3 chứa dữ liệu mô hình giả lập ghi rõ `test-fixture`; không biến kết quả test thành năng lực mô hình thật. Không có lượt suy luận nào hoặc cổng runtime được nghiệm thu ở lượt này.
- CI exact HEAD mới phải đọc kết quả thật sau commit; link/kết quả cuối được ghi trong PR và comment bàn giao. Không tái dùng CI của HEAD Vy hay của vòng trước.

### Bàn giao bắt buộc trên GitHub

Kết thúc lượt phải ghi trực tiếp vào Issue #4902 marker `P0_HANDOFF_G3_READY_FOR_VY_AUDIT`, HEAD SHA 40 ký tự, link CI/test, biên nhận hoặc blocker, phần đã đạt/chưa đạt và `NEXT_ACTION`; đọc lại comment để xác minh lưu thành công. Marker này chỉ là bàn giao, KHÔNG phải G3 accepted/DONE. Không yêu cầu anh Sơn chép báo cáo từ chat.

`NEXT_ACTION=VY_AUDIT_EXACT_G3_HEAD_AND_CI; PROVIDE_EXISTING_AUTHORIZED_ZERO_INCREMENTAL_COST_MODEL_TOOL_HOST_ADAPTER_BEFORE_ONE_REAL_CANARY; KEEP_G3_UNACCEPTED_UNTIL_MODEL_TOOL_RECEIPTS_VERIFIED`.

Không mở PR mới, không merge main, không deploy/cài PC01, không ghi nhánh actor khác. `DONE=false`; `DRIVE_SYNC=NOT_REQUIRED` do không đổi Loader hoặc cơ chế nạp.
