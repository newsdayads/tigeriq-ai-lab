# REA GH-4780 — R03: Kiến trúc sandbox cô lập và danh mục cổng quyền

**Trạng thái:** \`DESIGN_ONLY\` — chưa triển khai hoặc nghiệm thu trên PC01. Đây là thiết kế của mốc R03, không phải chứng nhận cài đặt R06, vận hành MCP R07, lease Core hay thiết bị thật.

**Nguồn sự thật:** [Issue #4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780), [Issue #504](https://github.com/newsdayads/tigeriq-ai-lab/issues/504), [Loader main](../../bootstrap/00_TIGERIQ_LOADER.md), [biên nhận thẩm định mã MCP và setup](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6188408220).

**Nguồn upstream cố định:** \`morluto/rea@a56f7bb668ab23fec8d33f7af353ac7ed2fe1895\` (\`rea-agents@6.4.0\`).
- [CLI dispatch](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/scripts/rea.mjs): lệnh \`mcp\` chuyển sang \`dist/main.js\`.
- [MCP entrypoint](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/main.ts) và [transport](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/main/transport.ts): stdio, **không chứng minh** tool/plugin/provider không kết nối mạng.
- [Lệnh setup](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/cli/setupCommands.ts): \`--yes\`, \`--all-detected\`, \`--install-hopper\`, uninstall \`--purge-data\` có phạm vi thay đổi. **Không** chạy setup/update/uninstall trong bước này.
- [Shutdown](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/src/main/shutdown.ts): có đường đóng transport/provider/session trong mã nguồn, **không chứng minh** máy chủ hay file đã được hoàn nguyên thực tế.

## Sơ đồ cô lập (đề xuất, chưa cấp quyền thi hành)

\`\`\`mermaid
flowchart TD
    Owner[Đầu vào jq 1.7 được phép / JSON tổng hợp] --> ReadGate[Kiểm soát quyền dùng và loại bí mật]
    Source[REA 6.4.0 / commit + gói pin] --> Supply[Kiểm tra nguồn, SHA512 và chuỗi cung ứng]
    ReadGate --> HostGate{R05 quyền PC01 / lease thật?}
    Supply --> HostGate
    HostGate -->|Không| Stop[STOP - không cài hoặc chạy]
    HostGate -->|Có và duyệt đúng phạm vi| VM[VM dùng một lần NGOÀI host, không admin]
    VM --> Net[Ingress / egress / DNS / proxy DENY ALL ở lớp hypervisor]
    VM --> Files[Input chỉ đọc; output tạm; cấm HOME, secrets, host service, thiết bị]
    VM --> Limits[CPU/RAM/disk/process/time quota và kill switch bên ngoài]
    VM --> Tools[Tool allowlist rỗng cho tới R07; cấm setup/update/browser/ADB]
    Net --> Audit[Audit redacted, no raw export]
    Files --> Audit
    Limits --> Audit
    Tools --> Audit
    Audit --> Review[Đối chiếu bằng chứng và huỷ VM, xác nhận không ảnh hưởng host]
\`\`\`

## Danh mục cổng quyền và bằng chứng bắt buộc

| Cổng | Người/nguồn kiểm chứng | Tiêu chí trước khi chuyển pha | Trạng thái ngày 15/10/2026 |
|---|---|---|---|
| G-R03-01 Nguồn | R02 upstream + npm official | Cố định version 6.4.0, commit, published tarball SRI + native digest; phân biệt việc đã xác minh với chưa | Nguồn upstream đã đọc; **chưa tuyên bố host admission** |
| G-R03-02 Pháp lý/đầu vào | Owner hoặc người có thẩm quyền mẫu | Chỉ \`jq 1.7\`, JSON tổng hợp, ghi nguồn/quyền dùng; không DRM, tài liệu mật hay ứng dụng sản xuất | Mẫu đã ghi ở R08; REA chưa chạy |
| G-R03-03 Chủ ghi | Core executor / R05 | Biên nhận atomic scoped lease có owner, token/fencing, TTL/heartbeat và quyền hành động PC01; không dựa metadata \`MUTATION_OWNER=NONE\` | **CHƯA XÁC MINH** |
| G-R03-04 Cách ly hệ thống | Quản trị host/VM | VM dùng một lần ngoài host, non-admin, không host user mapping, không host service socket/drive/clipboard/passthrough; chứng minh với runtime độc lập | **CHƯA KIỂM CHỨNG** |
| G-R03-05 Mạng | Hypervisor / firewall operator | Deny ingress, egress, DNS, proxy ở ranh giới ngoài guest; test chặn thực địa, không chỉ biến môi trường hoặc stdio | **CHƯA KIỂM CHỨNG** |
| G-R03-06 File & bí mật | Chủ sở hữu dữ liệu / R05 | Input hợp pháp chỉ đọc, output ephemeral, không gắn HOME, credential store, USB, SSH socket, token hoặc thư mục TigerIQ/PC01 | **CHƯA KIỂM CHỨNG** |
| G-R03-07 Hạn mức | VM/container operator | Tối đa 2 vCPU, 2048 MiB RAM, 4096 MiB disk, 64 process, 600s wall time, kill từ ngoài VM; kiểm tra OOM/timeout | **CHƯA KIỂM CHỨNG** |
| G-R03-08 Tools | R07 / security owner | Khởi đầu allowlist rỗng; không setup/update/browser/ADB/external provider/privileged helpers. Mở từng chức năng bằng cổng riêng, không tự nới | **CHƯA ĐƯỢC MỞ** |
| G-R03-09 Audit/hoàn nguyên | Reviewer độc lập | Không xuất raw inputs/credentials ra công khai; log đã lọc; snapshot trước/sau; kiểm tra VM bị xoá; phục hồi cấu hình nguyên trạng | **CHƯA KIỂM CHỨNG** |
| G-R03-10 Phát hành | Owner + cơ chế duyệt hợp lệ | Không triển khai Production/PC01, không tải lên public, không chi phí, không tự xin quyền bằng prompt | **KHÔNG ĐƯỢC PHÉP** |

**Fail-closed:** thiếu bất kỳ quyền/bằng chứng nào thì chỉ dừng **thao tác cài/chạy** tương ứng. Bước đọc/thiết kế R03 được tiếp tục; không dựng Core lease giả để chặn nghiên cứu.

## Hợp đồng kiểm tra cấu hình R03 bằng mã nguồn

Tệp \`r03-sandbox-plan-gate.mjs\` cung cấp \`inspectR03SandboxPlan(plan)\` không truy cập hệ thống, không cài gói, không mạng và không tự cấp quyền. Kiểm tra các trường \`schema\`, \`source\`, \`isolation\`, \`network\`, \`mounts\`, \`limits\`, \`tools\`, \`sample\`, \`audit\`, \`gate\`; trường lạ bị từ chối bằng mã lỗi **không trích nội dung nguồn**.

- \`DESIGN_CANDIDATE_ONLY\`: dữ liệu mô tả kiến trúc hợp lệ **trên giấy**; vẫn \`execution_authorized=false\`, \`host_verified=false\`.
- \`DESIGN_REJECTED\`: kế hoạch sai/thiếu cổng; vẫn không cho thi hành.
- Không có trạng thái \`ACTIVE\` hoặc \`INSTALL_APPROVED\` của validator. Chỉ kiểm tra VM, network firewall và thiết bị **thực** trên executor có quyền mới có thể cấp runtime receipt.

Kiểm thử tương ứng: \`tests/rea-reconstruction-lab/r03-sandbox-plan-gate.test.ts\`; kết quả CI xác minh định dạng và ranh giới **của mô tả thiết kế**, không phải thí nghiệm sandbox thật.

## R04–R07: điều kiện bàn giao kế tiếp

R04 cần kế hoạch deploy tái lập ở môi trường tách biệt: chốt digest đã xác minh, backup, rollback, không sửa home, bản kê file trước/sau, dry-run không ghi (không tự coi CLI \`--dry-run\` sạch khi chưa test), hướng dẫn thu hồi quyền/VM. R05 cần quyền trên đúng máy và lease Core thật. R06 cài đặt chỉ sau R05. R07 mới nghiệm thu MCP/hạn chế tool ở runtime; việc đọc mã upstream hoặc CI trên repo **không** làm đạt R05–R07.

Không chạy bất kỳ chương trình REA, không cài đặt trên PC01, không tương tác App Chrome, không đánh dấu ứng dụng tái tạo xong.
