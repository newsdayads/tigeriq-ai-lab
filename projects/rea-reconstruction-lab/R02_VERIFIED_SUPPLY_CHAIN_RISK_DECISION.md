# REA #4780 — R02: Thẩm định bằng chứng và quyết định NO-GO

**Quyết định ngày 15/10/2026:** `R02_RISK_DECISION=NO_GO_PC01_INSTALL`. Đây là **kết quả đánh giá rủi ro trước triển khai**, không phải chứng nhận gói sạch, sandbox hoạt động hay quyền thực thi R05. Tập hợp các biên nhận đã được thực hiện trước đây; **không chạy lại** SHA, SRI, OSV, TUF hoặc các fixture cũ.

**Phạm vi:** `rea-agents@6.4.0`, upstream commit `a56f7bb668ab23fec8d33f7af353ac7ed2fe1895`; Work Order [#4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780); thiết kế [R03](./R03_SANDBOX_ARCHITECTURE.md), runbook [R04](./R04_DEPLOYMENT_ROLLBACK_RUNBOOK.md).

## Kiểm chứng, giới hạn và rủi ro

| Hạng mục | Nguồn đã đo thật / xác minh được | Giới hạn cần giữ nguyên |
|---|---|---|
| Phát hành & phiên bản | [Release CI và npm publish](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6174680998): SHA upstream chính xác, 1.161 tệp, publish success | CI xanh không chứng nhận phần mềm an toàn |
| Byte tarball & Windows addon | [Biên nhận gói npm chính thức](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6182737356): tarball 1.825.761 byte; SHA1 `c919f5c7742ab2abf601db422e4e8fea36d511c2`; SRI `sha512-Vj1zWfSlna5bphGoaoI/TcVBuYvze9u+OyPC3Shz8YkBqaCTqB4COnnRoX7XDwMpwI24ZlFEel2yEj0k8LTWEQ==`; Windows addon SHA256 `c4fd9f377e567bcf15ba3fec3e0b0ed965d82b765a2adcdac49e46f14524b6d5` | Chưa có readback của byte trên chính máy ảo được duyệt |
| Provenance/CT | [TUF v1→v15](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6183025652), [Rekor](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6182891248) và [Fulcio SCT](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6183171375) có biên nhận ký số thật | Root v1 cross-check HTTPS/GitHub, không pin ngoài băng, không có trạng thái anti-rollback bền vững |
| Giấy phép | Upstream [LICENSE](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/LICENSE) MIT tại Git blob `2d476d24fa5a9ae2ab35e5fd121494049eb2ee5d`; [package.json](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/package.json) ghi MIT. [Inventory](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6174835434) chứa notices bên thứ ba; [README third_party](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/third_party/README.md) phân biệt engine tùy chọn | Chưa chứng minh toàn bộ điều kiện license/notice trên consumer tree và engine thực dùng; **không** tự kết luận vi phạm bản quyền |
| SBOM & phụ thuộc | [OSV 561/561 dòng dependency](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6183171375), 0 advisory trả về tại thời điểm kiểm; [source lock 561 dòng](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6184929504), hai gói dev gắn `hasInstallScript` | **Gói npm phát hành không chứa package-lock hoặc npm-shrinkwrap**; một lượt cài thật có thể resolve khác. Chưa có **consumer SBOM đã resolve**. OSV 0 không chứng minh mã sạch |
| Script/cài đặt | [Source lock audit](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6184929504) và [nguồn setup](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6188408220); root package không khai preinstall/install/postinstall | Lifecycle transitive chưa chứng minh; REA setup/update/uninstall có khả năng ghi cấu hình |
| Quyền/mạng/telemetry | [Quét static 1.143 tệp](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6183276098): 21 network, 23 child-process, 99 filesystem write/remove, 56 environment **regex hits**. [MCP stdio audit](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6188408220) | Regex hits **không phải runtime execution hay bằng chứng gửi telemetry**. Stdio không đảm bảo network deny. Chưa có host network/process/file-isolation receipt |
| Máy và quyền | [R00/R01 readback Core/PC01](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6189075602): PC01 sống, 14 resources, 0 live leases; **không có resource NV02** | Không thể coi 0 lease = đã sở hữu lease. R05 identity/action-specific permission chưa có. Chưa có VM cách ly thật |

## Risk register trước khi đổi NO-GO

| Rủi ro | Mức | Cổng để tái xét |
|---|---|---|
| Consumer dependency resolution, transitive lifecycle scripts và SBOM chưa chốt | Cao | Ghi manifest đầy đủ, pin resolved dependency tree trong sandbox dùng một lần có quyền; rà license/script thực |
| Native addon, process/FS/ADB/browser privileges | Cao | Non-admin VM ngoài host, deny home/secrets/USB/socket, phân quyền tool R07, giám sát quá trình thực |
| Network/telemetry/CDP có khả năng thoát khỏi sandbox | Cao | Hypervisor-enforced deny-all ingress/egress/DNS/proxy và biên nhận test từ lớp ngoài, không dựa stdio |
| Third-party notice/engine license chưa đóng | Trung bình | Rà consumer manifest và engine tùy chọn theo exact digest |
| Supply-chain rollback và thiếu bootstrap root trust độc lập | Trung bình | Pin trust ngoài băng và trạng thái rollback chống downgrade |
| Không có owner Core thực và ủy quyền máy cho R05 | Cao | Claim nguyên tử qua executor hợp lệ với workId/resourceId/lease token/fencing/TTL/heartbeat, quyền hành động PC01 cụ thể |

## Quyết định cuối R02 và điều kiện đổi trạng thái

**NO-GO cho R06/PC01 ngay bây giờ.** R02 hoàn tất ở phạm vi **đánh giá và quyết định an toàn dựa trên chứng cứ có giới hạn**; những mục chưa kiểm được liệt kê rõ và là nguyên nhân NO-GO. Không gọi đây là Full Security PASS hoặc đủ chuẩn cài máy. Mọi chỗ thiếu dữ liệu vẫn `UNVERIFIED`, không hạ mức rủi ro theo suy đoán.

Chỉ cân nhắc GO nếu có bản consumer dependency/SBOM pin thực, đối chiếu license, VM cô lập với kiểm thử egress/FS/process/rollback và quyền R05 cùng biên nhận Core thật. Các việc này không thuộc phép nghiệm thu báo cáo R02. R03/R04 đã nghiệm thu thiết kế và dry-run **không thay** R05, R06, R07. Work Order #4780 tiếp tục OPEN, DONE=false; không cài REA hay dùng tài khoản AI khác làm chủ lease thay NV02.
