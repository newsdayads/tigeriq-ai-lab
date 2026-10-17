# GH-4780 R09 — REA 6.4.0 real analysis: source-to-evidence trace (PARTIAL)

**Scope:** Read-only examination of immutable real REA GitHub Actions evidence; product-first independent lane authorized within Issue #4780. This is a **partial R09 traceability deliverable**, not the R09 checklist acceptance. It does not install or run REA on PC01, grant an NV02/Core lease, verify live MCP, or demonstrate behavioral equivalence.

## Evidence, hash and authority

| Item | Independently read-back evidence |
|---|---|
| Execution | [GitHub Actions isolated run 38990906351](https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38990906351); `rea --help` and `analyze-javascript-application` exit 0 from original runner status, **not** re-executed for this report |
| Downloaded artifact | [rea-4780-real-install-evidence #12084942996](https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/38990906351/artifacts/12084942996); ZIP SHA256 `257efaa66002237f9b5c3f35ece081ca2ba582f7db12a9423447eb7befd0a628` (matching GitHub artifact digest) |
| Original target | `janl/node-jsonpointer` commit `4a253c0d8f0d4d7f4c01f566bf8bf16f775dcdca`; `jsonpointer.js` Git blob `dad907d763f7369ac0e284e7d1fae2bd5508f477`; MIT license Git blob `ac32f5dfdd49682b416374dcbed58a7f17fa4e24` |
| REA JSON | ZIP member `rea-analysis.json`; **522,974 bytes**; SHA256 `8052a379036f1a0a9e2cc7ec58a7df9faba957f09d247f8a9c28f7f237a3d062` — actual bytes checked against `rea-analysis-verified.json` and `rea-run.sha256` |
| Type | Provider `rea-javascript-application`, operation `analyze_javascript_application`, `predicate_type=rea.javascript-application-analysis`, `confidence=derived`; graph obtained from **static AST**, not a dynamic runtime trace |
| Artifact lifetime | GitHub artifact was listed unexpired on 17 October 2026 and scheduled to expire **24 October 2026**; source link may later cease to download, so the content digest is mandatory provenance |

The archive also contains `rea-analysis.stderr`: 14 ordered progress events ending in a terminal completed marker. These progress messages do **not** prove REA's inferred semantics or external runtime behavior. `consumer-lock-static-report.json` explicitly says `STATIC_LOCK_SHAPE_PRESENT_NOT_RUNTIME_VERIFIED` and sets `deviceAuthorized=false`, `leaseOwned=false`, `hostIsolationVerified=false`, `installed=false` for **that separate lock-inspector's acceptance flags**; these do not contradict the independently recorded isolated runner command exit 0.

## Source-to-result mapping

REA parsed exactly **one JavaScript file**, `jsonpointer.js`, **2,591 source bytes**, **424 visited AST nodes**, **zero parser failures**, and reported **three export findings**. The application graph contains **6 nodes, 5 edges**, a single CommonJS module and three `exposes` edges.

| Static REA observation | Source location / trace | What can be asserted | What cannot be inferred |
|---|---|---|---|
| `get` is a CommonJS export | `jsonpointer.js:98`, `exports.get = get`, graph export edge | Public export exists in pinned source | Return values for arbitrary input, successful execution |
| `set` is a CommonJS export | `jsonpointer.js:99`, `exports.set = set`, graph export edge | Public export exists; original function delegates to `setter` | Side effects or safety for arbitrary input |
| `compile` is a CommonJS export | `jsonpointer.js:100`, `exports.compile = compile`, graph export edge | Public export exists; static return object contains `/get` and `/set` callable fields | Actual returned closures' behavior or JS environment dependencies |
| `get` static returns | REA source locations 70, 74, 75 | Three return sites retained with `return_shape_coverage.status=complete` | Values are `unknown` for dynamic keys/unbound `undefined`; no inferred equality to D04 |
| `set` static return | REA source location 83 | One return site retained | `value_status=unknown` from an unsupported call expression |
| `compile` static return | REA source locations 88–95 | `value_status=object`, fields `/get`, `/set` | Actual function bodies remain `unknown`; no behavioral equivalence claim |

REA's 5 graph edges consist of two `contains` and three `exposes`. It did **not** identify an Electron window, preload/context bridge, IPC channel, utility process, or native addon in this **single small target**. That is not a negative finding for other applications.

## Semantic uncertainty / explicit non-observations

- The semantic graph contains **307 nodes**, **266 relations**, **9 static function fingerprints**, and **90 explicit unknown records**. Its coverage status is **`unknown`** (not verified complete); 37 relations were retained as `candidate`, not resolved. The application graph itself reports `coverage.status=complete` for its narrower retained static artifact graph.
- The five REA limitations disclose inert syntax analysis, dynamic/obfuscated path uncertainty, and lack of bundle bootstrap execution. Do not call this a live system/API/IPC behavior trace.
- No authenticated PC01 execution, REA MCP session, host sandbox/rollback acceptance, Core lease, runtime API call, or runtime performance measurement was present in the downloaded evidence.
- Existing D04 JSONPointer CLI comparison tests and package results are a **separate** clean-room behavioral evidence stream; combining them with this REA AST map still does not establish full API equivalence or R09 pass.

## New executable source-to-behavior bridge (separate R09 paired oracle)

The separately added test `tests/rea-reconstruction-lab/r09-jsonpointer-source-to-runtime.test.ts` runs the **pinned original MIT CommonJS source** via Node VM in an isolated test process, then compares `outcome()` from the new D04 implementation and an actual spawned JSONL CLI process on **14 new, non-replayed input cases**. It checks SHA1 Git blob provenance before execution. This is **runtime behavioral evidence** independent of REA's static AST output, not REA-generated dynamic tracing.

| Trace IDs | Observed contract under test | Relation to REA |
|---|---|---|
| R09-T01–T05 | UTF-8 escaped keys; array pointer numeric segment; unknown tilde escape kept literal; nested empty path segment; zero index | REA statically locates `get` export at source line 98 but does not know concrete values |
| R09-T06–T08 | Array replacement; construction of nested array/object; escaped pointer-array setter | REA statically locates `set` export at source line 99 but does not establish mutation semantics |
| R09-T09–T11 | Missing `value` means delete; object subtree replacement; intermediate empty key creation | Source `setter` mutation and return values require real execution; not established by AST |
| R09-T12–T14 | Double pointer escape; append via `-`; safe missing descent through scalar parent | Same source exports, verified separately by paired original/CLI execution |

The regression also **separately labels deliberate safety differences, not parity**:

| Case | Original MIT behavior | D04 conservative behavior | Classification |
|---|---|---|---|
| R09-E01 `/constructor/x` write | Returns original object when forbidden segment encountered | Rejects unsafe segment with an error | INTENTIONAL_SECURITY_EXCLUSION |
| R09-E02 write beyond current array length | Can create sparse array holes | Rejects unbounded/sparse expansion, document unchanged | INTENTIONAL_SECURITY_EXCLUSION |
| R09-E03 empty-root string `set` | Mutates property named `undefined` under original setter implementation | Rejects invalid root assignment | INTENTIONAL_SECURITY_EXCLUSION |

**Material uncovered gap:** Original MIT `exports.compile` at line 100 returns pre-bound `get`/`set` closures. A new real-source test invokes these closures and checks the analogous D04 direct operations; **D04 JSONL CLI has no `compile` operation** and must return `Unsupported operation.` This is an OPEN FEATURE GAP, not a passing equivalence result. No CLI compilation of callable functions has been implemented or implied.

Paired test acceptance is proven only by the **exact changed-head CI** output. The test prints `GH4780_R09_REAL_SOURCE_CLI_PARITY=14_OF_14` with SHA256 of the normalized original-output array, and separate safety/compile-gap markers, if it passes. A GitHub PR or this document alone does not constitute execution evidence. 28 older gold cases are left intact; no new R09 checklist completion is claimed.

## Requirements to carry forward (not accepted yet)

1. Bind each exported API `get`, `set`, `compile` to observable original-versus-reconstruction cases, including escaped pointer segments, empty pointer variants, mutation/return semantics, and protected-property boundaries; keep runtime observations separate from REA inference.
2. For each claimed feature, retain (a) pinned original blob + source range, (b) REA graph node/edge or explicit unknown, (c) original executable result, (d) reconstructed CLI result, and (e) difference / deliberate safety exclusion. Do not imply unsupported behavior passed.
3. R09 must still deliver the complete feature/module/API/uncertainty trace with independently reproducible comparison and approved device/lease boundaries if a protected integration is later attempted.

**Status:** `R09_PARTIAL_REAL_STATIC_EVIDENCE_ONLY`; `R09_ACCEPTANCE=false`; `R05_FULL_ACCEPTANCE=false`; `R06_R07_PC01=false`; Issue #4780 historical checklist `6/16`, `DONE=false`. No PC01, Core, Chrome, credential, paid-service, npm installation, or device-write action occurred in this report generation.


## R09-C addendum (17/10/2026): biên dịch đường dẫn an toàn, chưa phải nghiệm thu R09

Thẻ nguồn [GH-4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780), nhánh thay đổi [PR 4982](https://github.com/newsdayads/tigeriq-ai-lab/pull/4982).

Sau giai đoạn ban đầu có khoảng trống `compile`, bản độc lập v0.6.0 cung cấp `compile(pointer)` **chỉ trong JavaScript** để tạo closure ràng buộc một lần, đồng thời cung cấp hai thao tác JSONL **`compile-get` và `compile-set`** với kết quả là JSON thường. Chức năng **không** chuyển đổi một closure JavaScript thành dữ liệu JSON có thể thực thi; việc từ chối `op=compile` nguyên dạng trong JSONL là cố ý, không còn đồng nghĩa API JavaScript chưa hỗ trợ `compile`.

Bộ thử mới `tests/rea-reconstruction-lab/r09-jsonpointer-compile-runtime.test.ts` đối chiếu **10 ca mới**: closure từ mã MIT nguồn gốc ghim blob `dad907d763f7369ac0e284e7d1fae2bd5508f477`, closure nội bộ mới, đầu ra lệnh CLI thực. Ngoài ra có kiểm tra 4 trường hợp giới hạn: phản đối đường dẫn nguy hiểm, chỉ số mảng thưa, con trỏ không hợp lệ và từ chối tuần tự hóa hàm. Không tính lại 14 ca R09 trước hay 28 ca D04 làm thành quả mới.

**Cổng nghiệm thu:** phải đọc log CI đúng SHA cuối PR, nhận 10/10 và 4 trường hợp an toàn, cùng các cổng Queue/Vercel, rồi đọc lại nguồn `main` sau hợp nhất. Chỉ khi đó mới báo phần tính năng R09-C được nghiệm thu; đây vẫn là R09 **một phần**, không biến R05–R07 thành đã đạt. Không cài/triển khai PC01, không nhận lease NV02, không nối MCP. 6/16 mốc toàn thẻ giữ nguyên cho tới khi nghiệm thu đủ các ô bắt buộc.
