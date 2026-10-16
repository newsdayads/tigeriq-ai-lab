# REA — R02 pinned license notices, source only

**Issue:** https://github.com/newsdayads/tigeriq-ai-lab/issues/4780 | **state:** `SOURCE_ONLY_NOT_INSTALL_OR_LEGAL_ACCEPTANCE`.

## Provenance and test contract
Pinned `morluto/rea@a56f7bb668ab23fec8d33f7af353ac7ed2fe1895`, `rea-agents@6.4.0`. Official source `package-lock.json` Git blob `3b28f2d827f3a7baad04e36ea2f4302427b5f567`, TigerIQ `r06-real-upstream-production-closure.json` Git blob `dbd61f2cb166076898ed798f653be91e930f3e37`. The JSON inventory stores **148/148** source-production paths and their matching package version, integrity and license metadata. 0 absent declarations. Upstream repo tag `package.json.version` and `license` matched the exact lock metadata for all seven focus packages, and tagged `LICENSE` text was read with blob SHA pinned in JSON.

Histogram: MIT 115, ISC 11, Apache-2.0 7, BSD-3-Clause 7, BlueOak-1.0.0 5, BSD-2-Clause 1, (MIT AND Zlib) 1, (MIT AND BSD-3-Clause) 1. Preserve **AND** terms; they are not MIT-only.

## Seven source-tag license notices
| Package | Tagged source license and provenance | Action at any future distribution stage |
|---|---|---|
| glob 13.0.6 | [isaacs/node-glob v13.0.6 LICENSE.md](https://github.com/isaacs/node-glob/blob/v13.0.6/LICENSE.md), blob `881248b6` | BlueOak notice or link; root LICENSE also warns `src/` packages carry individual notices |
| lru-cache 11.5.2 | [v11.5.2 LICENSE.md](https://github.com/isaacs/node-lru-cache/blob/v11.5.2/LICENSE.md), blob `c5402b95` | BlueOak notice/link |
| minimatch 10.2.5 | [v10.2.5 LICENSE.md](https://github.com/isaacs/minimatch/blob/v10.2.5/LICENSE.md), blob `8cb5cc6e` | BlueOak notice/link |
| minipass 7.1.3 | [v7.1.3 LICENSE.md](https://github.com/isaacs/minipass/blob/v7.1.3/LICENSE.md), blob `c5402b95` | BlueOak notice/link |
| path-scurry 2.0.2 | [v2.0.2 LICENSE.md](https://github.com/isaacs/path-scurry/blob/v2.0.2/LICENSE.md), blob `c5402b95` | BlueOak notice/link |
| pako 1.0.11 | [tagged LICENSE](https://github.com/nodeca/pako/blob/1.0.11/LICENSE), blob `a934ef8d`; [tagged README](https://github.com/nodeca/pako/blob/1.0.11/README.md), blob `e952992c` | Tagged README: MIT except `/lib/zlib`, which is Zlib; carry both copyright/notices |
| sha.js 2.4.12 | [browserify/sha.js v2.4.12 LICENSE](https://github.com/browserify/sha.js/blob/v2.4.12/LICENSE), blob `11888c13` | Retain MIT **and** BSD-3-Clause redistribution/copyright notices |

BlueOak license notice requirement is documented by the [license steward](https://blueoakcouncil.org/license/1.0.0) and [OSI](https://opensource.org/license/BlueOak-1.0.0).

## Evidence boundaries
Source tags and npm lockfile metadata are *not* bytes of the actual published tarballs or consumer-installed packages; `LICENSE` inclusion in the eventual deliverable and complete `glob/src` subpackage notices remain unchecked. This audit is not a legal opinion or distribution permission. No real REA build, npm install, PC01 host isolation or live Core claim occurred. `R05` still lacks actual authorized NV02 executor/device scope and valid owned atomic lease; `R06` is NO-GO pending consumer-resolved lock/SBOM and independently verified runtime isolation.

Automated regression: `tests/rea-reconstruction-lab/r02-license-notice-inventory.test.ts` validates 148 path/version/integrity pins against the existing frozen manifest, eight license expressions, seven tagged notice records, negative tampering and fail-closed authorization flags. This validates **checked-in artifacts**, not a live npm download. Work Order remains `DONE=false` at 6/16, no checklist claim.
