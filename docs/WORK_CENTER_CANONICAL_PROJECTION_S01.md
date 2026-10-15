# GH-4858 S01 — Hợp đồng hình chiếu Work Center thống nhất, chưa phát hành runtime

**Phạm vi:** P1 [#4858](https://github.com/newsdayads/tigeriq-ai-lab/issues/4858), `RESOURCE_SCOPE=TIGERIQ_WORK_CENTER_GITHUB_TRUTH_SYNC_REGRESSION_20261015`.

## Mục tiêu

`apps/tigeriq-core/work-center-canonical-contract.mjs` là hợp đồng dữ liệu và phép biến đổi **thuần chỉ đọc** để Core Health / Web Control / Live dùng ở bước tích hợp tiếp theo. Nó tái sử dụng parser checklist đã có ở `work-order-checklist-hard-gate.mjs`, không sinh hàng đợi, database, lease, API, quyền hoặc nguồn sự thật thứ hai.

### Trường canonical

- **Định danh:** `version, number, title, priority, resourceScope, workKind`.
- **Trạng thái:** `status, closed, doneDeclared, claimedActive, runtimeVerified, leaseOwned`.
- **Tiến độ:** `checklistFound, checklistValid, steps, progressCompleted, progressTotal, progressPercent, progressProof`.
- **Đầu việc:** `currentStep, nextAction, evidenceUrl, updatedAt`.
- **Tính đầy đủ:** `source.state, source.complete, source.stale, source.sha, source.issueUpdatedAt`.

### Ranh giới tin cậy

1. Một Issue được đóng **không** chứng minh DONE; mặc định `CLOSED_UNVERIFIED`. Text `DONE=true` chỉ là lời khai, cần nghiệm thu riêng.
2. `NOT_EXECUTING`, policy `_REVIEW`, hoặc `ACTIVE_EXECUTION=true` **không** là lease. Module không tự trả `RUNNING` hoặc `DONE`. Trường `runtimeVerified` và `leaseOwned` mặc định false. Bước sau chỉ được đặt trạng thái thực thi từ receipt Core đã xác thực.
3. Mốc % lấy từ **ô checklist trên Issue**; không bao giờ hiển thị 100% khi thiếu nghiệm thu terminal. Trùng ID/thiếu checklist trả `null`, không bịa số.
4. GitHub phân trang hoặc snapshot thiếu, cũ, SHA không hợp lệ, `issueUpdatedAt` không khớp => `TRUNCATED` hoặc `UNVERIFIED`, không tự nhận đầy đủ. `source.complete` là khai báo của adapter sau khi đọc mọi trang, **không** phải chứng minh chữ ký hay nhận quyền.
5. Ba giao diện phải tiêu thụ **cùng bộ trường**; kiểm thử nguồn so sánh 3 nguồn tiêu thụ đồng nhất với fixtures `#4780 6/16`, `#280 NOT_EXECUTING`, `#504 system`. **Chưa tích hợp vào máy thật** nên chưa được gọi là 3/3 runtime UI PASS.

## Ranh giới nghiệm thu

PR này là **S01 hợp đồng nguồn và kiểm thử mô phỏng**. Các bước S02–S09 tiếp tục cần tích hợp vào Core/API/Web, xử lý phân trang/độ cũ, bảo vệ nhánh, phát hành PC01 có biên nhận, HTTP :8795/:8796 và kiểm thử thiết bị thật. Không chạm #4780 R05, App Chrome, Production, ngân sách, khóa hoặc bí mật. Không báo #4858 DONE chỉ vì có PR/CI.

