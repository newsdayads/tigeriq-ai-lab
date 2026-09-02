# COMPANY CONTROL TOWER — PREVIEW VIEW-MODEL V2

Status: CHAT 01 UI ADAPTER ONLY · NON-AUTHORITATIVE CONTRACT PLACEHOLDER  
Work Order: WO-049 / Issue #147  
Operating Model basis: PR #144 exact `5589f61b9123d49681ab62a71c1f7728a3c6cd99`  
Business-state owner: Issue #146 / CHAT 03  
Release boundary: no MAIN/Production, no paid service.

## Purpose

Cho phép Web Control dựng ngay Company Control Tower theo Company Operating Model V2 trong khi #146 chốt business-state contract tối thiểu. Tài liệu này KHÔNG định nghĩa schema authoritative mới và KHÔNG thay thế PostgreSQL/Work Management/business-state design của CHAT 03.

## Owner home information architecture

Thứ tự ưu tiên:
1. Goal quan trọng + KPI health.
2. Kết quả kinh doanh/doanh thu/chi phí khi có nguồn authoritative.
3. Mission đang chạy + tiến độ/outcome mong đợi.
4. Department + AI Employee.
5. `CẦN SẾP` / Exception / Owner Action.
6. Business Outcome mới hoàn tất.
7. Business Process health.
8. Runtime health ở mức tóm tắt.

SHA/CI/lease/port, Controller detail, Job detail, provider/quota, device, Prompt và Result/Evidence trace chuyển xuống `Vận hành kỹ thuật`.

## Truth rule

`buildCompanyControlTowerViewModel(snapshot, { previewBusiness })` có hai nhánh:

### Mock / preview
- `source.authoritative` bắt buộc là `false`.
- Có thể nạp `previewBusiness` để hoàn thiện UX/IA.
- Tất cả record mẫu phải gắn `isMock=true` và UI hiển thị `MẪU`.
- Không được dùng mock để xác nhận Goal/KPI/Mission/Outcome live.

### Controller authoritative
- Chỉ authoritative khi `source.mode='controller'` và `source.authoritative=true`.
- Preview business data bị bỏ qua hoàn toàn.
- Nếu snapshot chưa có business projection từ contract #146, business view trả `BUSINESS_CONTRACT_PENDING` và các collection Goal/KPI/Mission/OwnerAction/Outcome/Process rỗng.
- Web KHÔNG suy diễn Mission/KPI/Outcome từ Job/Result runtime.

## Compatibility projection only

Trong giai đoạn #146 chưa chốt tên trường, adapter chỉ có thể đọc optional projection từ một trong các container tạm:
- `businessState`
- `business`
- `companyBusiness`

Các key được UI đọc nếu tồn tại:
- `goals[]`
- `kpis[]`
- `performance.metrics[]`
- `missions[]`
- `ownerActions[]` hoặc `exceptions[]`
- `outcomes[]`
- `processes[]`

Đây là compatibility adapter, không phải yêu cầu backend. Khi #146 có contract cuối, CHAT 01 phải map adapter sang contract đó và xóa alias không cần thiết mà không phá IA/UI.

## Existing runtime contract retained

Web vẫn dùng Controller client hiện tại:
- `GET /api/workforce/status` — probe.
- `GET /api/web/v1/snapshot` — runtime snapshot.
- `POST /api/web/v1/goals` — Owner goal intent.
- `POST /api/web/v1/prompts/versions` — Prompt version intent.
- `POST /api/web/v1/jobs/:jobId/retry` — retry intent.

Browser không dùng Controller admin secret. Public Controller URL và HTTPS→HTTP mixed content tiếp tục fail closed.

## Operating Model invariants surfaced in UI

- Goal/KPI/outcome quan trọng hơn task count.
- AI Employee identity tách khỏi model/provider.
- Mission `jobRefs` chỉ là reference tới runtime Job, không tạo queue authoritative thứ hai.
- `CẦN SẾP` ưu tiên ngoại lệ cần quyết định cụ thể.
- Business finance metrics phải hiện `chưa có nguồn` khi chưa map accounting/CRM authoritative; không tự điền số để tạo cảm giác live.
- Technical Operations không được trở thành homepage mặc định.

## Test gates

- Unit: mock preview không thể trở thành authoritative; live Controller thiếu business projection không được nhận mock fallback.
- UI contract: đủ 8 vùng Owner home và Technical Operations drill-down.
- Mobile Playwright: viewport 390×844, không horizontal overflow, bottom nav fixed, touch target >=44px, business-first home, technical SHA/lease labels ẩn cho tới khi mở Technical Operations.
