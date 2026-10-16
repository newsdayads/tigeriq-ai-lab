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

## R06 — Fail-closed ranges for pinned REA 6.4.0 source (16/10/2026)

**Material gap before this change:** previous R06 code only compared exact pins; any existing package row with a valid registry URL and metadata could pass `^X.Y.Z`, `~X.Y.Z` and major-only edges while actually violating the declared constraint. This affected **148** of **159** edges in the pinned REA upstream 148-package production closure (146 caret, one tilde, one major-only).

The static preflight now supports **only** the four spec shapes found in that pinned corpus: exact `X.Y.Z` (including exact prerelease), caret `^X.Y.Z`, tilde `~X.Y.Z`, and major-only `1`. It rejects mismatching resolved versions with `DEPENDENCY_RANGE_MISMATCH` while preserving exact-pin mismatch classification. For a non-exact range, prerelease resolved versions are rejected conservatively. Unsupported specs, including `>=`, `*`, `npm:` aliases and partial caret expressions, fail closed with `UNSUPPORTED_DEPENDENCY_SPEC` **even for absent optional dependencies**. This deliberately may reject valid consumer npm resolutions outside the pinned corpus; it does not claim full npm semver compatibility.

Immutable [morluto/rea upstream lock](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/package-lock.json), Git blob `3b28f2d827f3a7baad04e36ea2f4302427b5f567`: 159 versioned dependency edges in source production closure, 11 exact, 146 caret, 1 tilde, 1 major-only. Do not interpret source consistency as an actual consumer-resolved lock, authenticated npm install, transitive byte integrity, host isolation, Core lease or PC01 install authorization. R05/R06 remain unchecked and `NO-GO`.

## R06 — Minimal consumer root scope guard (16/10/2026)

Work Order #4780, cùng nhánh P2; đây là **bộ kiểm tra cấu trúc lockfile chưa tin cậy**, không phải bằng chứng cài REA.

**RED thực trên GitHub:** [PR #4937](https://github.com/newsdayads/tigeriq-ai-lab/pull/4937), [CI test-first](https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38918255756) xác nhận ba nhóm kiểm thử âm tính mới thất bại. Một `packages[""].dependencies.zod` thêm vào dù đã có dòng `node_modules/zod`, hoặc một `devDependencies`/`optionalDependencies`/`peerDependencies` gốc và script/workspace bị chèn, đều bị bộ kiểm tra cũ gắn nhãn `STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED` thay vì bác bỏ.

**Quy tắc mới cho consumer tối giản dành riêng REA:** phần dependencies của root chứa duy nhất `rea-agents@6.4.0`; các map bổ sung của root (`devDependencies`, `optionalDependencies`, `peerDependencies`, `scripts`) phải vắng hoặc rỗng; không có danh sách workspace/bundled dependency; cờ `hasInstallScript` và `gypfile` không được true hoặc giá trị lạ. Nếu lệch, trả `REJECTED / CONSUMER_ROOT_SCOPE_DRIFT`, không xuất raw command, không thực thi bất kỳ script nào.

**Ranh giới:** `package-lock.json` có thể không đủ dữ liệu để chứng minh mọi `package.json` script; đầu vào bất kỳ vẫn không được xác thực bằng byte/hash SBOM của consumer. Cờ `sourceAuthenticated=false`, `lockByteDigestVerified=false`, `installed=false`, `actualSbomVerified=false`, `leaseOwned=false`, `deviceAuthorized=false`, `hostIsolationVerified=false`, `installAuthorized=false` giữ nguyên. R05 và R06 còn NO-GO; không npm install, không PC01, không sửa quyền hay production.
