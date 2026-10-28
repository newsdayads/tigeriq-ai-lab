# QUY CHUẨN VẬN HÀNH TIGERIQ ENTIRE-NATIVE (DUAL-PUSH)
Cập nhật: 2026-10-28
Quyền quyết định: Chỉ đạo trực tiếp của anh Sơn (Owner)

## 1. Kiến Trúc Vận Hành Tinh Gọn (Zero-Overhead)

```
                 +-------------------------------------+
                 |           ANH SƠN (OWNER)           |
                 +-------------------------------------+
                                    |
                    +---------------+---------------+
                    |                               |
                    v                               v
         +--------------------+          +--------------------+
         |  ANTIGRAVITY (EM)  |          |  CHATGPT / APP CHR |
         |   Interactive PC01 |          |   (NV02 / NV03)    |
         +--------------------+          +--------------------+
                    |                               |
            [Dual-Push 1 lệnh]               [Đọc qua Web/API]
                    |                               |
         +----------+----------+                    |
         |                     |                    |
         v                     v                    v
+------------------+  +-------------------------------------+
|   KHO ENTIRE     |  |            KHO GITHUB               |
| (Nguồn chuẩn V2) |  |   (Đọc việc / Backup mirror an toàn)|
| /et/tigeriqai/   |  |   newsdayads/tigeriq-ai-lab         |
| tigeriq-ai-lab   |  +-------------------------------------+
+------------------+
```

## 2. Quy Tắc Phân Vai
- **Kho Entire (`/et/tigeriqai/tigeriq-ai-lab`):**
  + Là kho mã nguồn chính thức cho Antigravity (em).
  + Lưu trữ phiên làm việc AI có kiểm soát qua Entire CLI (`0.12.2`).
  + Chạy kiểm thử tự động độc lập qua PC01 CI/CD runner: `D:\TigerIQ\Next\cicd_runner.ps1`.
- **Kho GitHub (`newsdayads/tigeriq-ai-lab`):**
  + Tiếp tục duy trì để ChatGPT (NV02 / App Chrome) đọc mã nguồn, đối chiếu Work Orders và thực hiện review/nghiên cứu.
  + Đóng vai trò bản sao lưu an toàn (backup mirror) liên tục.
  + Không xóa, không ngắt kết nối cũ để tránh làm đứt gãy luồng của ChatGPT.

## 3. Lệnh Thao Tác Chuẩn Trên PC01
- **Đẩy mã lên cả Entire và GitHub cùng lúc:**
  ```bash
  git push all <tên-nhánh>
  ```
  Hoặc chạy script:
  ```cmd
  D:\TigerIQ\Tools\push_all.cmd <tên-nhánh>
  ```
- **Kiểm tra trạng thái Entire CLI:**
  ```cmd
  entire doctor
  entire status
  ```
- **Chạy kiểm thử CI/CD độc lập trên PC01:**
  ```powershell
  D:\TigerIQ\Next\cicd_runner.ps1
  ```
