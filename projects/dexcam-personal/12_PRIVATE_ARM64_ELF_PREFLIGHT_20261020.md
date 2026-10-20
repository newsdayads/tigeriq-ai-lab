# GH-4625 — P01 private APK ARM64 ELF 16-KiB preflight (20/10/2026)

WORK_ORDER=GH-4625 | RESOURCE_SCOPE=DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD
RESULT=OFFLINE_STATIC_REPORT_ONLY | P01_REA=BLOCKED | G1_G2=NOT_ACCEPTED | D01=NOT_BUILT
SOURCE_ONLY=true | NO_PRIVATE_APK_OR_DEX_IN_GITHUB=true | NO_RDC=true | NO_PC01_SHELL=true

## Đầu ra mới và cách tái kiểm

- Source: [p01-private-elf-preflight.mjs](p01-private-elf-preflight.mjs).
- Regression: [p01-private-elf-preflight.test.mjs](../../tests/dexcam-personal/p01-private-elf-preflight.test.mjs), 12 ca synthetic; lệnh `node --test tests/dexcam-personal/p01-private-elf-preflight.test.mjs`.
- Chỉ khi có APK gốc trong **sandbox riêng được cấp quyền**, chạy:
  `node projects/dexcam-personal/p01-private-elf-preflight.mjs <PRIVATE_APK_PATH> <EXPECTED_SHA256>`
- Bắt buộc so SHA-256 trên **toàn APK trước khi parse**. Chỉ đọc, không chạy APK; từ chối ZIP native member mã hóa/lỗi CRC, ELF ARM64 không hợp lệ, kích thước ngoài hạn mức. Output chỉ có số lượng và trạng thái, không in tệp/thư mục, lớp Java hay chuỗi tư nhân. Khi lỗi, chỉ trả mã lỗi tổng quát.
- Bản kiểm tra CLI trên host Windows vẫn chưa được đo. Tool dùng Node.js 20+; source và phép thử cô lập chạy trên Linux/Node.
- Kết quả không kiểm ZIP layout/page-alignment của **APK cuối**, không chạy Android hoặc xác nhận REA. ELF p_align 16 KiB là một tiền kiểm nguồn cần thiết, không đủ để chứng minh tương thích runtime.

## Biên nhận chạy trên APK thực trong sandbox hội thoại, không đăng binary

Source chính chủ trong Google Drive riêng tư đã đối chiếu với [biên nhận P00/P01 PC01](https://github.com/newsdayads/tigeriq-ai-lab/issues/4625#issuecomment-6257021547):

| Thuộc tính không nhạy cảm | Kết quả |
| --- | --- |
| Full APK SHA-256 | `6e1717d4df469c4c9fb8639d1f4cd4a8eb431b270b0521326250dcb2c89bde7f` — MATCH |
| APK byte count | `34121912` — MATCH |
| ARM64 native ELF files | `10` |
| ARM64 ELF đạt tiền kiểm 16 KiB | `4` |
| ARM64 ELF không đạt tiền kiểm 16 KiB | `6` |
| ARM64 PT_LOAD segments | `20` |
| PT_LOAD với `p_align=4096` | `12` |
| Classification | `ELF_STATIC_16K_INCOMPATIBLE` |

Kiểm chứng chéo độc lập bằng `python zipfile + struct` cùng APK và SHA cho kết quả **10 / 4 / 6**, **20 phân đoạn / 12 phân đoạn 4 KiB**. Đây là thuộc tính của **APK UltraCar tham khảo**, không phải bản DeXCam mới và không chứng minh ứng dụng sẽ lỗi trên thiết bị Android cụ thể.

## Rào chắn nghiệm thu

- Không đưa APK, DEX, mã nguồn ứng dụng của bên thứ ba, tên thư viện tư nhân, đường dẫn/số seri lên GitHub.
- P01 dùng REA trên PC01 vẫn **chưa đạt** do Windows native DACL Win32 5. [Upstream issue](https://github.com/morluto/rea/issues/5237) chưa có bản sửa được kiểm thử.
- C01/G1/G2 chưa có đủ bằng chứng USB/UVC/R trên thiết bị thật. Chưa thể bắt đầu/nhận D01 Android Kotlin/Gradle/APK theo cổng hiện hành.
- Không thay mục `- [ ]`, không tăng bộ đếm 13/30; chỉ chốt một **đầu ra tiền kiểm nguồn** có khả năng tái chạy.
- Quyền phát hành source: nhánh → PR → exact-head CI → merge khi đầy đủ; **không** được coi merge tài liệu/tool là bản phát hành ứng dụng.
