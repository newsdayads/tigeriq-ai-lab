# NV10 API Doctor — quy trình phục hồi NV11–NV20
Version: 2026-10-15 | Owner direct | Source: GitHub main #1255, #280, #504
Scope: Chăm sóc **chỉ NV11–NV20**. NV06 OpenClaw là PC01 local operator; NV08/NV09/NV10 là local AI; không gộp hai loại tác vụ vào cùng API diagnosis.

## Nguồn & bằng chứng theo thứ tự
1. PC01 live `/api/status` và `/api/api-doctor-status`: provider/employeeId, credential_state, health_state, work_state, quota_state, cooldown_until, current_job_id, lastScanAt. Dashboard ONLINE không tự chứng minh nhận việc thật.
2. Nhật ký Core `RESOURCE_FAILURE`, `RESOURCE_PROBE_FAIL`, `RESOURCE_PROBE_OK`, `RESOURCE_SUCCESS`, durable normal job DONE + accepted output; tránh lỗi cũ sau sự kiện thành công mới.
3. Local **metadata only**: hồ sơ Free / bằng chứng account UI do Owner cung cấp, timestamp, loại hợp đồng; DPAPI key artifact exists/nonempty không phải chứng minh key valid. Không đọc, giải mã, gửi hay ghi plaintext secret.
4. Provider's actual bounded API response / quota headers / dashboard rate limits. Phân biệt Free account, model quota, key lifetime, local proof expiration. Lưu mã phản hồi đã xóa bí mật.
5. Existing GitHub source/work order + owner policy. Đọc lịch sử thẻ đóng: `NOT_PLANNED` không phải DONE. Không tạo issue, probe hoặc canary trùng trạng thái và lỗi chưa đổi.

## Quy tắc tự động bắt buộc
| Lớp lỗi | NV10 được làm | NV10 không được làm |
|---|---|---|
| `WAIT_KEY` + local proof quá hạn | Phân biệt **hạn xác nhận TigerIQ** và **hạn key nhà cung cấp**; kiểm tra proof Free có Owner standing consent hiện hành và cổng chi phí; kiểm tra file khóa **chỉ metadata** | Tạo key, bỏ kiểm tra Free, gia hạn bằng ngày/ảnh giả, tự bật billing |
| Groq/Gemini Free | Với standing consent có nguồn thật, launcher tự nạp key DPAPI sẵn có; không cần đặt lại expiry 30 ngày. Kiểm tra Core credential READY và 1 probe có giới hạn | Cam kết Free vĩnh viễn, tự công nhận billing liên tục đã kiểm tra bằng API khi chưa được cấp read-only IAM |
| HTTP 429 / quota | Tôn trọng `cooldown_until`; Gemini confirmed `RPD` chờ **Pacific midnight**; RPM/TPM có backoff riêng; có thể route NV khác thật sự FREE | Gọi thử liên tục khi cooldown còn hiệu lực; tạo key mới cùng project để né quota; bật trả phí |
| `HTTP_402` / free credits | `EXTERNAL_BLOCKED`, giữ no-paid, đưa Owner chi tiết lý do và thông tin nhà cung cấp | Bật plan/pay-as-you-go |
| `HTTP_401/403` | `auth/account gate`, kiểm tra metadata endpoint/quyền/model đúng nguồn, đưa Owner bước thao tác giao diện | Reset secret, thêm đặc quyền IAM, bypass xác thực |
| `EMPTY_RESPONSE`, `PROBE_UNEXPECTED_RESPONSE` | Thu thập response shape đã loại bí mật, đối chiếu adapter/parser/model support, test offline và tối đa một probe hợp lệ sau thay đổi. Phân biệt contract probe và normal output | Endless probe, ép ONLINE, tự đổi sang model có phí |
| API thành công trở lại | Cần `RESOURCE_PROBE_OK` để xác nhận kết nối; `RECOVERED` chỉ khi **normal Core job DONE**, `result.ok=true` và output accepted, xảy ra sau handoff/lỗi cần nghiệm thu | Nhận `probe` là normal job; báo recovered từ Issue closed |
| PC01 / GitHub thay đổi | Branch→PR→exact-head CI→actual allowed review/waiver→merge→PC01 protected release COMMITTED→readback installed SHA→test normal job | Direct main, fake pass, bypass guard, đổi App Chrome, lấy atomic lease không có biên nhận |

## Bài học phiên thực tế 15/10/2026
- NV11/Groq: 3 API Keys trên trang Console cùng `Expires: Never`, tổ chức `Free $0`. Giấy `groq-free-tier-proof.json` hết hạn 08/10 là policy TigerIQ, không phải key đã hỏng. Owner cấp ảnh tài khoản Free; cập nhật proof scope Free/no-paid, giữ ACL và backup; không đổi key. Bounded probe 791ms; normal job `NVAPI-498cc43b-aa22-4905-8b11-ba8c76143cdc` DONE, sau đó ONLINE / READY / IDLE.
- NV12/Gemini: Google AI Studio project Free, billing not configured (Owner screenshots); `gemini-free-tier-proof.json` trước đó hết hạn 08/10. Hạn mức Gemini 3.5 Flash Lite từng đỉnh `594/500 RPD` trong 28 ngày: **không phải quota remaining hôm nay**. Sau standing Free proof, Core tự nạp khóa; normal jobs `NVAPI-50f435bd-4222-459e-898a-1f8b85323d58` và hậu phát hành `NVAPI-8ced9b5b-da42-4714-8f46-5ba458d78e3a` DONE. Khi confirmed daily 429, controller chờ reset và không tự retry.
- NV13/OpenRouter: `EMPTY_RESPONSE` (15/10), prior #4595 `CLOSED_NOT_PLANNED`; không tái tạo thẻ cũ, cần chứng cứ contract riêng cho phê duyệt source nếu phát sinh việc mới.
- NV14/Mistral: `HTTP_429` cooldown; không thử khi chưa hết hạn.
- NV15/Cloudflare: lặp `PROBE_UNEXPECTED_RESPONSE` (15/10). Đó là **probe failure**, không đồng nghĩa key hết hạn; kiểm chứng model/support/parser và giới hạn số lần thử.
- NV16/Hugging Face: `HTTP_402`, external Free-tier/credit gate.
- NV18/IBM Watsonx: `HTTP_403`, account/role gate; không tự sửa quyền.
- NV17/Inception, NV19/Cohere, NV20/NVIDIA: normal Core jobs có biên nhận DONE 15/10; không phá tình trạng khỏe.
- NV06: PC01 OpenClaw local **operator/automation** (provider `openclaw`), danh sách UI Local hợp lệ; không đổi nhãn nghề hoặc Core capability thành Ollama.

## Hợp đồng nghiệm thu và trạng thái
- `SOURCE_FIXED`: merged exact GitHub SHA, không suy ra runtime.
- `PC01_RELEASED`: protected receipt COMMITTED, installed SHA khớp, live Core health.
- `CONNECTED`: bounded provider probe PASS.
- `FUNCTIONAL`: normal Core job DONE + accepted output + correct resource/employee binding.
- `EXTERNAL_WAIT`: provider quota, Free/billing, key, account, permission gate không thể tự mở. Chỉ báo Owner khi cần can thiệp thật.
- Việc tạm thời bị ngoại tác không làm toàn hệ thống mất giá trị: route an toàn qua NV khác khả dụng, không giả full 10/10.

## Nhịp vận hành
NV10 scan tự động với chính sách hạn mức; lịch và `lastScanAt` phải kiểm chứng qua runtime. Không tạo automation mới chỉ để thay thế cơ chế đã có. Mỗi nguồn một chữ ký lỗi có chống trùng, chỉ làm lại sau lỗi mới/bằng chứng thay đổi; nếu chưa thay đổi, chờ. Trước khi báo Owner, tóm tắt bảng NV / failureClass / lệnh đã thực hiện / bằng chứng / blocker / next. Tất cả phương án phải giữ `TIGERIQ_ALLOW_PAID_AI=false`, key mã hóa, một writer, và phạm vi #504.
