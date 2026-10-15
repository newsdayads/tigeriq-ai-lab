# R06 — Production source dependency closure: 148 real upstream-lock packages

**Scope:** [GH-4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780) REA. **Evidence state:** `SOURCE_ONLY_PARTIAL_PROVENANCE` — **not** consumer SBOM, installation, security approval or Core lease.

### Immutable primary source

- [morluto/rea `package-lock.json` at pinned commit `a56f7bb668ab23fec8d33f7af353ac7ed2fe1895`](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/package-lock.json), Git blob `3b28f2d827f3a7baad04e36ea2f4302427b5f567`. Parsed the entire **289,613 UTF-8 characters** through authenticated GitHub read-only connector.
- [Upstream `package.json` at same commit](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/package.json), Git blob `0947dd7c4577c93825b5804748c739010722a085`.
- Compared all **35** direct dependency name/version pairs in upstream manifest, lockfile root, and TigerIQ `r06-consumer-lock-preflight.mjs` (Git blob `1555a48688c9dcdc3b072d40e96550b33395379d`): **35/35 identical**, no substitution.
- Machine-readable [reference graph manifest](./r06-real-upstream-production-closure.json) records **148 real package rows**, exact upstream version, registry URL and SRI **metadata** for later comparisons; not a produced consumer installation.

### Analysis reproducibility

Start at 35 upstream **root runtime dependencies**; traverse `dependencies` and `optionalDependencies` recursively; resolve a name from a nested `node_modules` parent upward to top-level, without adding `devDependencies` or peer-only dependency edges. Count reachable package paths exactly once; sort their paths.

| Source-lock measurement | Grounded count |
|---|---:|
| Upstream lock dependency rows (excluding root) | **561** |
| Rows with SHA512-shaped integrity and registry.npmjs.org resolved URL | **561 / 561** |
| Direct dependencies in manifest/lock/TigerIQ pin | **35 / 35** |
| Reachable source production graph rows | **148** |
| Missing graph dependencies | **0** |
| Source production graph optional-flagged rows | **6** |
| Source production graph dev-flagged rows | **0** |
| Source production graph install-script-flagged rows | **0** |
| Install-script-flagged rows in whole upstream lock | **2, both dev** |

Whole-source `hasInstallScript` metadata flags: `node_modules/fsevents@2.3.3` (`dev=true; optional=true`) and `node_modules/vitepress/node_modules/esbuild@0.25.12` (`dev=true`). These are **metadata flags**, not a guarantee scripts cannot execute.

**Important npm alias:** `node_modules/typescript-termux` has the actual `devDependency` declaration `npm:typescript@5.9.3`, so its legitimate resolved URL `https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz` differs from the alias's `node_modules` path. This is **not evidence of a malicious substitution**. The alias is **absent** from the 148-row source production graph.

### What this does NOT prove

1. The published npm REA tarball does not ship the upstream `package-lock.json` — prior [R02 real artifact audit](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6183171375). A **consumer-resolved lock/SBOM** from the authorized target environment with platform/optional/peer resolution is still missing.
2. Source `resolved` and `integrity` strings do not establish actual bytes of all downloaded consumer tarballs, their licenses, full runtime scripts, OSV-free code, or verified external isolation. This turn made **no** npm installation/network execution or PC01 write.
3. **R05 remains unaccepted:** no authenticated NV02 Core resource, bounded atomic claim/lease receipt or scoped device action permission, as in [new live-PC01 check](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6199723558). Thus **R06 installation remains NO-GO**.

Prior 561-row OSV and 2-script flags had already been researched; **new independent increment here is the exact 148-row source production graph with path/version/SRI reference, 0 unresolved edges, 35/35 three-way pin comparison and explicit real npm alias classification.** Work Order stays `OPEN|DONE=false|6/16`; never tick R05/R06 based on this report.
