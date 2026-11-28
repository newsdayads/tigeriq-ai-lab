# TiG GLB QA

Offline, read-only technical screening for **embedded glTF 2.0 binary files (GLB)**. Requires Node.js 22 or newer; no npm dependencies.

## Run

```bash
node tools/tig-glb-qa/inspect.mjs path/to/model.glb
```

For a CI-style gate that returns a non-zero status when the technical screen is not met:

```bash
node tools/tig-glb-qa/inspect.mjs path/to/model.glb --require-technical-pass
```

## Exit codes

- `0`: the file was parsed; with the strict flag, the technical screen also passed.
- `1`: malformed, unsupported, or unreadable input / invalid command line.
- `2`: valid input, but the technical screen is `NOT_MET` (strict flag only).

The JSON report includes the input SHA-256, mesh/triangle counts, UV and degenerate-triangle findings, embedded-image count, and informational skin/morph counts.

## Supported scope and limits

- GLB v2 with JSON first, embedded BIN second, one embedded buffer, and embedded PNG/JPEG/WebP image payloads.
- Triangle primitives; required POSITION min/max bounds are checked against vertex data; reserved maximum index values are rejected; optional TEXCOORD_0 checks; bounded triangle budget.
- `rigScreen` is informational: `NOT_CHECKED` when skins are declared. This tool does not validate joint/weight bindings, skeleton correctness, animation quality, or deformation.
- Image checks validate framing/signatures and PNG chunk CRCs, not full image decoding or visual quality.
- No external URI fetching, file mutation, model execution, likeness assessment, visual acceptance, N1/G1 acceptance, or release authorization.

A `technicalScreen: PASS` is **not** art/visual acceptance and never makes `releaseEligible` true. Human visual review and the project's separate acceptance gates remain mandatory.

## Tests

```bash
node --check tools/tig-glb-qa/inspect.mjs
node --test tools/tig-glb-qa/inspect.test.mjs
npx vitest run tests/tig-glb-qa.test.ts
```

The TypeScript/Vitest suite is a required companion regression suite. Run it with the repository's genuine Vitest installation; a Node compatibility shim is not Vitest.
