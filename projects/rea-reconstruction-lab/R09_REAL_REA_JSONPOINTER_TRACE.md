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

## Requirements to carry forward (not accepted yet)

1. Bind each exported API `get`, `set`, `compile` to observable original-versus-reconstruction cases, including escaped pointer segments, empty pointer variants, mutation/return semantics, and protected-property boundaries; keep runtime observations separate from REA inference.
2. For each claimed feature, retain (a) pinned original blob + source range, (b) REA graph node/edge or explicit unknown, (c) original executable result, (d) reconstructed CLI result, and (e) difference / deliberate safety exclusion. Do not imply unsupported behavior passed.
3. R09 must still deliver the complete feature/module/API/uncertainty trace with independently reproducible comparison and approved device/lease boundaries if a protected integration is later attempted.

**Status:** `R09_PARTIAL_REAL_STATIC_EVIDENCE_ONLY`; `R09_ACCEPTANCE=false`; `R05_FULL_ACCEPTANCE=false`; `R06_R07_PC01=false`; Issue #4780 historical checklist `6/16`, `DONE=false`. No PC01, Core, Chrome, credential, paid-service, npm installation, or device-write action occurred in this report generation.
