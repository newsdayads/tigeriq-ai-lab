# REA — Kiểm tra tĩnh cấu trúc cây phụ thuộc phía người cài

**Trạng thái:** `SOURCE_ONLY_NOT_R06_ACCEPTANCE` — mã nguồn/kiểm thử độc lập, không cài REA, không gọi npm, không tiếp xúc PC01, Core hay App Chrome. [Work Order #4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780) giữ nguyên 6/16 mốc đã được nghiệm thu, R05/R06 chưa hoàn thành.

## Căn cứ nguồn đã kiểm chứng
- Upstream `morluto/rea` commit `a56f7bb668ab23fec8d33f7af353ac7ed2fe1895`: `rea-agents@6.4.0`, 35 dependency trực tiếp ghim chính xác; `package.json` Git blob `0947dd7c4577c93825b5804748c739010722a085`.
- Mã SRI tarball cố định lấy từ [R02](./R02_VERIFIED_SUPPLY_CHAIN_RISK_DECISION.md). Gói phát hành **không** chứa consumer resolved lockfile/SBOM thực, vì vậy số lần kiểm thử nguồn xanh không làm thay đổi quyết định R02 `NO_GO_PC01_INSTALL`.

## Bộ chẩn đoán mới (không ghi)
Tệp `r06-consumer-lock-preflight.mjs` chỉ đọc **đối tượng JSON do bên ngoài đưa vào bộ kiểm thử**, không mở tệp, không mạng, không cài package, không sửa Core/PC01. Chỉ kiểm tra định dạng `lockfileVersion=3`, pin root REA 6.4.0 và SRI đúng, đối chiếu 35 dependency với npm package upstream, kiểm tra mỗi mục kho npm có URL HTTPS, SHA512, phiên bản, và sự tồn tại tham chiếu dependency theo đường `node_modules`. Cờ `hasInstallScript=true` được đếm, không tự chứng minh script an toàn. Mọi URL nguồn khác, integrity yếu, link, phiên bản khác hoặc tham chiếu thiếu đều bị bác.

**Không có quyết định cho phép cài:** đầu vào mô phỏng hợp lệ chỉ trả `STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED`. Kể cả như vậy, `installed=false`, `sourceAuthenticated=false`, `lockByteDigestVerified=false`, `actualSbomVerified=false`, `transitiveScriptsVerified=false`, `leaseOwned=false`, `deviceAuthorized=false`, `hostIsolationVerified=false` và `installAuthorized=false`.

## Những việc chưa được xác minh
1. Có bytes của consumer lock thực, SHA nguồn tin cậy và đối chiếu resolver npm cùng cây `node_modules`/SBOM do môi trường cài có quyền tạo.
2. Script cài đặt gián tiếp và optional/platform dependencies được đối chiếu toàn bộ; trình kiểm tra tĩnh không phải thuật toán npm resolver đầy đủ, và không đánh giá an toàn phần mềm/giấy phép.
3. R05 có biên nhận actor, quyền hành động PC01, lease Core thực, fencing/TTL/heartbeat; đồng thời có VM thử độc lập cô lập file/network/process/rollback tại lớp host.
4. R06 cài đặt/chạy REA chỉ sau **tất cả** cổng thực; không dùng bản kiểm tra dữ liệu giả để đánh dấu checkbox R06.

**Kiểm thử nguồn:** `tests/rea-reconstruction-lab/r06-consumer-lock-preflight.test.ts` gồm 9 nhóm thử dữ liệu tổng hợp, kiểm tra từ chối dữ liệu nguy hiểm và luôn phủ nhận quyền. CI chính thức chỉ nghiệm thu tính đúng của đoạn mã tại HEAD PR, không chứng minh R05/R06 host.

## R06 URL-to-package binding hardening (15/10/2026)

Chỉ kiểm tra host `registry.npmjs.org`, HTTPS và đuôi `.tgz` **không đủ**: một URL hợp lệ về cú pháp vẫn có thể trỏ tới gói/phiên bản khác. Bộ kiểm tra nguồn nay so khớp đường dẫn tarball với **tên thực tế từ khóa `node_modules` và phiên bản của dòng lock**. Gói REA gốc buộc URL `/rea-agents/-/rea-agents-6.4.0.tgz`. Hỗ trợ dạng scope chuẩn `/@scope/name/-/name-version.tgz` và biến thể scope escape URL khi giải mã đúng tên.

Các trường hợp URL bị thay gói, đổi scope, đổi phiên bản hoặc sai basename bị từ chối, kể cả khi hostname, SRI chuỗi và phiên bản metadata có vẻ hợp lệ. Đây **chỉ là kiểm tra nhất quán URL với metadata không tin cậy**, không phải kiểm chứng bytes, chữ ký, hash đúng nội dung hoặc cây SBOM thực. Mọi cờ quyền thực thi và trạng thái R05/R06 vẫn `false`.

## R06 — Optional native platform packages (2026-10-16)

New source defect: the checker required every `optionalDependencies` edge to resolve to a lock row. The pinned [REA upstream lockfile](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/package-lock.json) declares six `@lydell/node-pty@1.1.0` optional platform binaries (darwin/linux/win32, arm64/x64). A hypothetical consumer tree containing only win32-x64 was incorrectly rejected for its five omitted non-target rows.

As [npm documents](https://docs.npmjs.com/cli/configuring-npm/package-json/), an optional dependency may be unavailable without requiring npm to fail. The static checker now records `counts.missingOptionalDependencies` for absent optional edges, while continuing to reject missing **required** dependencies, malformed spec fields, or substituted tarballs for present entries. It does **not** infer that a missing Windows addon is harmless: platform eligibility, runtime native loading, consumer-resolved SBOM, actual bytes, license, isolation, authority and Core R05 lease remain unverified. All install/release/host authorization flags are still false. This is a shape-only diagnosis, **not** permission to install on PC01.

## R06 — Exact version dependency binding (16/10/2026)

**RED:** The source checker only required a `node_modules` row to exist. A present optional Windows native binary advertised as `@lydell/node-pty-win32-x64: 1.1.0` but supplied at `1.1.1` passed when its own registry URL/SRI were syntactically consistent. This also affected required transitive dependencies.

**Fix:** For present required or optional dependency edges with an exact `major.minor.patch` or supported exact prerelease spec, require resolved `package.version` to match the declared spec; otherwise return `REJECTED / DEPENDENCY_EXACT_VERSION_MISMATCH`. Missing optional OS packages remain counted without claiming installation. The upstream pinned REA 6.4.0 source has **11 exact-pin edges**, all 11 consistent in its upstream source lock; a real consumer-resolved tree remains unavailable.

**Limitation:** Flexible semver specs (`^1.2.3`, `~1.2.3`, major-only) are **not fully validated** by this function; a passing result is **not** an npm resolver proof, authenticated SBOM, byte digest, working native addon, isolation or R05/R06 permission. Real PC01 installation stays **NO-GO**.
