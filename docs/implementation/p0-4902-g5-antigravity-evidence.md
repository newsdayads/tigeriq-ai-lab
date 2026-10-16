# P0 #4902 — G5 Nghiệm thu sản phẩm thực (Product Acceptance Evidence — Vòng 2)

- **Date:** 2026-10-16
- **Assignee:** Gemini Pro (NV04 - nghiên cứu sâu và kiểm tra chéo) / Antigravity
- **Authority:** Explicit Owner Instruction (P0 #4902 Vòng 2)
- **Base Ref:** PR #4898 HEAD (`a50bde489214ece6d7ee1eb1f635cf8c6fe24a9e`), branch `p0/owner-vy-core-coding-contract-20261016`
- **Target Branch:** `p0/4902-g5-antigravity`
- **Target Pull Request:** [PR #4912 - [P0 #4902][G5] Cổng nghiệm thu sản phẩm thực độc lập — Antigravity (BẢN NHÁP)](https://github.com/newsdayads/tigeriq-ai-lab/pull/4912)
- **Status:** DRAFT / PENDING REVIEW (No merge to main, no deploy, no PC01 mutations)

---

## 1. Bối cảnh & Khắc phục rà soát Vòng 2 (Review Round 2 Fixes)
Theo phản hồi rà soát từ Vy (`Trợ lý điều phối`) và Owner tại [PR #4912](https://github.com/newsdayads/tigeriq-ai-lab/pull/4912), Antigravity đã vá triệt để 5 kẽ hở nghiệm thu giả:

1. **Bắt buộc Source SHA trên mọi biên nhận (Strict Head SHA Enforcement):**
   - Loại bỏ hoàn toàn điều kiện lỏng `if (matchingCheck.head_sha && ...)`.
   - Bắt buộc mọi `checkRun` và `receipt` phải có `head_sha` 40 ký tự hex hợp lệ và khớp chính xác `sourceHeadSha`. Thiếu `head_sha` bị chặn ngay lập tức với mã `ACCEPTANCE_BLOCKED_MISSING_HEAD_SHA` (`CHECK_HEAD_SHA_MISSING`, `RECEIPT_HEAD_SHA_MISSING`).
2. **Khắc phục logic trạng thái biên nhận (Strict Status & Conclusion Conjunction):**
   - Thay thế điều kiện lỏng cũ bằng kiểm tra nghiêm ngặt: yêu cầu đồng thời `status === 'completed'` VÀ `conclusion === 'success'`.
   - Chặn đứng các trường hợp giả mạo như `completed + failure` hoặc `in_progress + success` với mã `ACCEPTANCE_BLOCKED_EXECUTION_UNVERIFIED`.
3. **Chống che giấu lỗi bằng bản ghi trùng tên (Anti-Shadowing for Duplicate Checks):**
   - Quét toàn bộ danh sách `checkRuns` và `receipts` có cùng tên yêu cầu; không dùng `.find()` lấy bản ghi đầu.
   - Nếu bất kỳ lượt chạy nào cùng tên bị thất bại, đang chạy, thiếu SHA, hoặc sai SHA, toàn bộ cổng sẽ bị `BLOCKED` (không cho phép một check PASS che giấu một check FAIL hoặc sai SHA).
4. **Chặn tệp nguồn rỗng nội dung (Empty Content Rejection):**
   - `verifyProductArtifacts` không chỉ kiểm tra đường dẫn mà bắt buộc nội dung tệp phải có dữ liệu thực (`content.trim().length > 0`).
   - Nếu các tệp bắt buộc (Gradle, Manifest, Kotlin, UI code, API code) chỉ có tên hoặc nội dung rỗng, cổng trả về `BLOCKED` kèm lý do chi tiết (`ANDROID_GRADLE_EMPTY`, `ANDROID_MANIFEST_EMPTY`, `ANDROID_KOTLIN_EMPTY`, `FRONTEND_UI_CODE_EMPTY`, `BACKEND_API_CODE_EMPTY`, `PRODUCT_ARTIFACTS_EMPTY`).
5. **Xác thực nguồn runner của biên nhận (Runner Trustworthiness):**
   - Biên nhận từ các runner giả định, không xác định hoặc bị đánh dấu `unverified`, `fake`, `mock`, `unknown` sẽ bị từ chối với mã `ACCEPTANCE_BLOCKED_RUNNER_UNVERIFIED`.

---

## 2. Quy tắc nghiệm thu theo loại sản phẩm (Deliverable Acceptance Matrix)

| Loại sản phẩm | Tệp mã nguồn bắt buộc (Non-empty) | Kiểm chứng thực thi bắt buộc | Tiêu chí hợp lệ |
|---|---|---|---|
| **Android (`android`)** | Gradle (`build.gradle`, `build.gradle.kts`, `settings.gradle.kts`) + Manifest (`AndroidManifest.xml`) + Kotlin/Java (`.kt`, `.java`) | `Android Build Verify` (CheckRun / Receipt) | `status: 'completed'`, `conclusion: 'success'`, `head_sha === targetSha`, runner tin cậy |
| **Frontend (`frontend`)** | UI Components & Styles (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css`) | `Frontend Functional Verify` (CheckRun / Receipt) | `status: 'completed'`, `conclusion: 'success'`, `head_sha === targetSha`, runner tin cậy |
| **Backend (`backend`)** | API / Service handlers (`.mjs`, `.cjs`, `.js`, `.ts`, `.py`, `.go`, `.rs`, `.java`, `.kt`) | `Backend Contract Verify` (CheckRun / Receipt) | `status: 'completed'`, `conclusion: 'success'`, `head_sha === targetSha`, runner tin cậy |

---

## 3. Các đường tắt bị cấm (Prohibited Anti-Patterns)
1. **Chỉ có tài liệu Markdown:** Chặn ngay `DOCUMENTATION_ONLY_NOT_PRODUCT`.
2. **Chỉ có CI tổng quát (Generic CI):** `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify` không thể thay thế kiểm thử chuyên biệt -> Chặn `GENERIC_CI_CANNOT_SUBSTITUTE_PRODUCT_ACCEPTANCE`.
3. **Đóng Issue GitHub:** Tự động đóng issue hoặc ghi text `DONE=true` không thay thế được nghiệm thu sản phẩm thực -> Chặn `CLOSED_ISSUE_CANNOT_SUBSTITUTE_PRODUCT_ACCEPTANCE`.
4. **Sai lệch SHA:** Bất kỳ check nào không khớp exact `sourceHeadSha` -> Chặn `ACCEPTANCE_BLOCKED_SHA_MISMATCH`.

---

## 4. Kết quả kiểm thử tự động (Test Suite Results)
Bộ kiểm thử gồm **30 bài kiểm thử** (tăng cường 10 bài âm mới cho các lỗi rà soát Vòng 2):
- `API contract: exports all required constants and functions for Vy` — **PASS**
- `Android positive: Gradle + Manifest + Kotlin + real build verify -> ACCEPTED` — **PASS**
- `Android negative: missing Kotlin/Java code -> BLOCKED` — **PASS**
- `Android negative: missing AndroidManifest.xml -> BLOCKED` — **PASS**
- `Android negative: missing Gradle configuration -> BLOCKED` — **PASS**
- `Android negative: empty content in Gradle/Manifest/Kotlin files -> BLOCKED` — **PASS**
- `Android negative: missing real build check -> BLOCKED` — **PASS**
- `Android negative: build check SHA mismatch -> BLOCKED` — **PASS**
- `Frontend positive: UI code + functional test verify -> ACCEPTED` — **PASS**
- `Frontend negative: missing UI code -> BLOCKED` — **PASS**
- `Frontend negative: empty content in UI files -> BLOCKED` — **PASS**
- `Frontend negative: missing functional test check -> BLOCKED` — **PASS**
- `Frontend negative: functional check in progress or failed -> BLOCKED` — **PASS**
- `Backend positive: API code + contract test verify -> ACCEPTED` — **PASS**
- `Backend negative: missing API code -> BLOCKED` — **PASS**
- `Backend negative: empty content in API code -> BLOCKED` — **PASS**
- `Backend negative: missing contract test check -> BLOCKED` — **PASS**
- `Security check: checkRun missing head_sha must be BLOCKED` — **PASS**
- `Security check: receipt missing head_sha must be BLOCKED` — **PASS**
- `Security check: receipt with completed + failure must be BLOCKED` — **PASS**
- `Security check: receipt with in_progress + success must be BLOCKED` — **PASS**
- `Duplicate check shadowing: duplicate check where one failed cannot be masked by a passing check` — **PASS**
- `Duplicate check shadowing: duplicate check where one has different SHA cannot pass` — **PASS**
- `Security check: unverified / fake runner in receipt must be BLOCKED` — **PASS**
- `Anti-cheat: markdown / documentation only changes cannot claim product DONE` — **PASS**
- `Anti-cheat: generic CI alone cannot substitute product-specific verification` — **PASS**
- `Anti-cheat: closed GitHub Issue cannot substitute product acceptance` — **PASS**
- `Receipt object support: supports typed receipt objects matching exact SHA` — **PASS**
- `SHA validation: invalid or non-40-hex SHA is immediately BLOCKED` — **PASS**
- `assertProductAcceptance throws structured error when BLOCKED` — **PASS**

**Kết quả tổng kết:** 30/30 PASS (100%), 0 fail, 0 skipped.

---

## 5. Giới hạn & Phần chưa nghiệm thu (Known Limits & Unaccepted Scope)
- Đây là cổng nghiệm thu mã nguồn (source contract gate) trong phạm vi G5.
- Chưa nghiệm thu G6 (end-to-end runtime canary trên PC01).
- PR #4912 duy trì ở chế độ **DRAFT / NOT MERGED**.
- Không merge vào `main`, không kích hoạt phát hành Production, không sửa đổi runtime PC01.
