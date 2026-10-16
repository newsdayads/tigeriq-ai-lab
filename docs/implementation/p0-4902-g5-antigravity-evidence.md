# P0 #4902 — G5 Nghiệm thu sản phẩm thực (Product Acceptance Evidence)

- **Date:** 2026-10-16
- **Assignee:** Antigravity (NV04 - Nghiên cứu sâu & Cổng nghiệm thu độc lập G5)
- **Authority:** Explicit Owner Instruction (P0 #4902)
- **Base Ref:** PR #4898 HEAD (`a50bde489214ece6d7ee1eb1f635cf8c6fe24a9e`), branch `p0/owner-vy-core-coding-contract-20261016`
- **Target Branch:** `p0/4902-g5-antigravity`
- **Target PR Direction:** PR NHÁP hướng vào nhánh P0 của Vy (`p0/owner-vy-core-coding-contract-20261016`)
- **Status:** DRAFT / PENDING REVIEW (No merge to main, no deploy, no PC01 mutations)

---

## 1. Bối cảnh & Mục tiêu (Context & Objectives)
Theo chỉ đạo P0 #4902 và quy chuẩn kiểm soát sản phẩm TigerIQ:
- G5 chịu trách nhiệm xây dựng cổng nghiệm thu sản phẩm thực độc lập, bảo đảm chất lượng phần mềm được kiểm chứng bằng sản phẩm cụ thể và biên nhận kiểm thử thực tế, không chấp nhận báo cáo bằng lời, văn bản tự nhận, hoặc đóng Issue làm bằng chứng hoàn tất.
- Cổng được thiết kế dưới dạng module chuyên biệt `apps/tigeriq-coding-lane/product-acceptance.mjs`, kiểm thử độc lập tại `tests/coding-product-acceptance.test.mjs`, và cung cấp API rõ ràng để Vy (`NV00 - Trợ lý điều phối`) tích hợp vào luồng điều phối Coding Lane.

---

## 2. Quy tắc nghiệm thu theo loại sản phẩm (Deliverable-Specific Acceptance Gates)

### 2.1. Android (`android`)
- **Bắt buộc cấu hình xây dựng (Build Configuration):** Tệp Gradle hợp lệ (`build.gradle`, `build.gradle.kts`, hoặc `settings.gradle.kts`).
- **Bắt buộc Manifest:** `AndroidManifest.xml`.
- **Bắt buộc mã nguồn ứng dụng:** Tệp mã nguồn Kotlin hoặc Java (`.kt`, `.java`).
- **Bắt buộc kiểm chứng xây dựng thực (Real Build Verification):** Check run hoặc biên nhận `Android Build Verify` với trạng thái `completed` và kết luận `success`.
- **Xử lý thiếu sót:** Nếu thiếu bất kỳ tệp nào hoặc thiếu kiểm chứng build, trạng thái trả về là `BLOCKED` kèm mã lỗi cụ thể (`ANDROID_GRADLE_MISSING`, `ANDROID_MANIFEST_MISSING`, `ANDROID_KOTLIN_MISSING`, hoặc `ANDROID_REAL_BUILD_MISSING`). Tuyệt đối không giả PASS.

### 2.2. Frontend (`frontend`)
- **Bắt buộc mã giao diện (UI Source Code):** Tệp thành phần giao diện / kiểu dáng (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css`).
- **Bắt buộc kiểm thử chức năng (Functional Test Verification):** Check run hoặc biên nhận `Frontend Functional Verify` với trạng thái `completed` và kết luận `success`.
- **Xử lý thiếu sót:** Nếu thiếu mã giao diện hoặc thiếu kết quả kiểm thử chức năng, trạng thái trả về là `BLOCKED` (`FRONTEND_UI_CODE_MISSING`, `FRONTEND_FUNCTIONAL_TEST_MISSING`).

### 2.3. Backend (`backend`)
- **Bắt buộc mã API/Service:** Tệp mã nguồn backend (`.mjs`, `.cjs`, `.js`, `.ts`, `.py`, `.go`, `.rs`, `.java`, `.kt`).
- **Bắt buộc kiểm thử hợp đồng API (Contract Test Verification):** Check run hoặc biên nhận `Backend Contract Verify` với trạng thái `completed` và kết luận `success`.
- **Xử lý thiếu sót:** Nếu thiếu mã API hoặc thiếu kết quả kiểm thử hợp đồng, trạng thái trả về là `BLOCKED` (`BACKEND_API_CODE_MISSING`, `BACKEND_CONTRACT_TEST_MISSING`).

---

## 3. Quy tắc chống gian lận & đường tắt (Anti-Cheat & Prohibited Shortcuts)

1. **Markdown mô tả không phải sản phẩm (Documentation-Only Prohibited):**
   - Chỉ sửa/tạo tệp Markdown (`.md`, `.txt`, `.rst`) mà không có mã nguồn sản phẩm thực thi sẽ bị chặn ngay lập tức với mã `DOCUMENTATION_ONLY_NOT_PRODUCT` và lý do `MARKDOWN_DESCRIPTION_NOT_PRODUCT_DONE`.
2. **CI chung không thay thế kiểm thử chuyên biệt (Generic CI Prohibited):**
   - Các kiểm tra CI tổng thể (như `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`) chỉ chứng minh tính toàn vẹn của repo, không được dùng để tính nghiệm thu cho sản phẩm chức năng nếu thiếu check run chuyên biệt tương ứng (`GENERIC_CI_CANNOT_SUBSTITUTE_PRODUCT_ACCEPTANCE`).
3. **Đóng Issue GitHub không thay thế nghiệm thu (Closed Issue Prohibited):**
   - Trạng thái đóng Issue (kể cả có ghi `DONE=true` hay `FINISH_RECEIPT_URL`) không được tự động công nhận hoàn tất sản phẩm nếu thiếu kiểm chứng biên nhận độc lập (`CLOSED_ISSUE_CANNOT_SUBSTITUTE_PRODUCT_ACCEPTANCE`).
4. **Đối chiếu đúng Source SHA (Exact SHA Match):**
   - Mọi biên nhận thực thi và check run phải khớp chính xác với `sourceHeadSha` (40 ký tự hex). Bất kỳ sai lệch SHA nào đều bị chặn với mã `ACCEPTANCE_BLOCKED_SHA_MISMATCH`.
   - Nếu SHA không hợp lệ (rỗng, sai định dạng), lập tức chặn `SOURCE_HEAD_SHA_INVALID`.

---

## 4. Giao diện API xuất cho Vy tích hợp (Exported Integration Interface)

Mọi hàm và hằng số được xuất tại `apps/tigeriq-coding-lane/product-acceptance.mjs`:
- `PRODUCT_ACCEPTANCE_SCHEMA = 'TIGERIQ_PRODUCT_ACCEPTANCE_V1'`
- `SUPPORTED_PRODUCT_TYPES = ['android', 'frontend', 'backend']`
- `PRODUCT_REQUIRED_CHECKS = { android: ['Android Build Verify'], frontend: ['Frontend Functional Verify'], backend: ['Backend Contract Verify'] }`
- `verifyProductArtifacts({ productType, changes })`: Kiểm tra tính đầy đủ của các tệp mã nguồn theo loại sản phẩm.
- `verifyProductExecutionReceipts({ productType, sourceHeadSha, checkRuns, receipts })`: Kiểm tra biên nhận thực thi và khớp SHA.
- `evaluateProductAcceptance({ productType, sourceHeadSha, changes, checkRuns, receipts, issue, externallyVerified })`: Cổng nghiệm thu tổng thể trả về `{ pass, status, code, reasons, deliverableType, sourceHeadSha, details }`.
- `assertProductAcceptance(params)`: Ném lỗi `Error` có cấu trúc nếu nghiệm thu bị `BLOCKED`.

---

## 5. Kết quả kiểm thử (Test Results)

Bộ kiểm thử tại `tests/coding-product-acceptance.test.mjs` bao gồm 20 bài kiểm thử tích cực, tiêu cực và biên:
1. `API contract: exports all required constants and functions for Vy` - PASS
2. `Android positive: Gradle + Manifest + Kotlin + real build verify -> ACCEPTED` - PASS
3. `Android negative: missing Kotlin/Java code -> BLOCKED` - PASS
4. `Android negative: missing AndroidManifest.xml -> BLOCKED` - PASS
5. `Android negative: missing Gradle configuration -> BLOCKED` - PASS
6. `Android negative: missing real build check -> BLOCKED` - PASS
7. `Android negative: build check SHA mismatch -> BLOCKED` - PASS
8. `Frontend positive: UI code + functional test verify -> ACCEPTED` - PASS
9. `Frontend negative: missing UI code -> BLOCKED` - PASS
10. `Frontend negative: missing functional test check -> BLOCKED` - PASS
11. `Frontend negative: functional check in progress or failed -> BLOCKED` - PASS
12. `Backend positive: API code + contract test verify -> ACCEPTED` - PASS
13. `Backend negative: missing API code -> BLOCKED` - PASS
14. `Backend negative: missing contract test check -> BLOCKED` - PASS
15. `Anti-cheat: markdown / documentation only changes cannot claim product DONE` - PASS
16. `Anti-cheat: generic CI alone cannot substitute product-specific verification` - PASS
17. `Anti-cheat: closed GitHub Issue cannot substitute product acceptance` - PASS
18. `Receipt object support: supports typed receipt objects matching exact SHA` - PASS
19. `SHA validation: invalid or non-40-hex SHA is immediately BLOCKED` - PASS
20. `assertProductAcceptance throws structured error when BLOCKED` - PASS

Tổng số bài kiểm thử: **20/20 PASS (0 fail, 0 skipped)**.

---

## 6. Tuân thủ ranh giới thực thi (Boundary Compliance)
- Nhánh làm việc: `p0/4902-g5-antigravity` (tách riêng từ HEAD PR #4898, không ghi đè nhánh của Vy hay Work).
- Không sửa các tệp: `coding-lane.mjs`, `step-contract.mjs`, `package.json` hoặc tệp của AI khác.
- Không merge vào `main`, không deploy Vercel, không chạy build pipeline trên PC01.
