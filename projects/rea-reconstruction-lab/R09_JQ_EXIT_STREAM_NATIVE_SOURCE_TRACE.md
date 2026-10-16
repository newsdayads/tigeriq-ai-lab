# GH-4780 R09 — native jq 1.7 exit-status and stream-error evidence

**Scope:** Partial R09 source-to-behavior evidence. This is NOT REA execution, Core/PC01 access, or R09 checklist acceptance.

## Actual independent execution, not the 16 previous B-cases

New synthetic X01–X13 cases were run against installed Linux /usr/bin/jq reporting jq-1.7, executable SHA256 5e1dcc8c21b9362013a1f30acb24c69a128cbd5238364b88803f4c60cd9376dd. Actual stdout, stderr and numeric exit code were captured; 13/13 new cases replayed exactly in a separate local sandbox execution. Neither npm nor REA was installed. No remote device, credential, paid API or Core resource was touched.

Reproducible source module: r09-jq-exit-stream-native-oracle.mjs. Its complete ordered oracle array is pinned to SHA256 27248c84a2a05d3bc3b558eac4c31b78482eb8d9d0cfa8dbbb6a6844884cf98b over UTF-8 JSON.stringify(cases); the binary hash is pinned separately. CI tests validate the immutable oracle; they do not imply that CI or PC01 ran REA.

## Behavior / clean-room requirement trace

| New cases | Actual jq behavior | Conservative requirement |
|---|---|---|
| X01–X03 | jq -e returns 1 for null/false and 0 for true | Do not equate parseable JSON with success |
| X04 | jq -e empty emits no bytes and exits 4 | Preserve no-emission versus JSON null |
| X05–X06 | -e exit follows last emitted false/true | Preserve output order and final truthiness |
| X07 | Ordinary malformed JSON exits 5 with stderr parse error | Differentiate parser error from falsy result |
| X08 | --stream emits nested path-value and closing path records | Represent streaming as event stream |
| X09–X10 | --stream-errors outputs error events on stdout, empty stderr, exit 0 | Scan event payload for parse failure even on process success |
| X11 | Input duplicate key x reduces to output value 2 in this test | Last-wins observed for this exact input |
| X12 | Large integer text round-trips unchanged | Byte preservation does not prove arithmetic accuracy |
| X13 | -R -s preserves embedded and final newlines in JSON string | Separate raw text slurp from JSON parse |

Pinned source reference: jqlang/jq commit 11c528d04d76c9b9553781aa76b073e4f40da008; the observed system binary's build provenance to that commit is NOT verified. The table is a mapping of observed behavior to proposed specification requirements, not a REA-generated module diagram or trace.

## Explicit local replay only

In a separate Linux sandbox already containing the exact pinned executable, run:

    node projects/rea-reconstruction-lab/r09-jq-exit-stream-native-oracle.mjs --replay-isolated

Expect ISOLATED_JQ_1_7_NATIVE_BYTE_REPLAY_PASS, count=13, exit 0. The runner checks jq version/SHA, then all exact stdout/stderr/exit bytes with a timeout. No shell or network. The Vitest suite is source-integrity regression and does NOT silently invoke replay.

**Gate:** R05 NV02 resource identity and authorized atomic lease remain absent; R06 verified consumer-resolved SBOM and host isolation/install remain pending; R07 REA/MCP is not running. R09 acceptance, clean-room app build and work-order DONE remain unverified: **GH-4780 = 6/16, DONE=false**.
