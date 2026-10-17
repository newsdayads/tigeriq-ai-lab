# NV02 D02 — first legal JavaScript original and ten golden observations

**Parent:** [GH-4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780). This is a source/original-behavior deliverable, **not** REA execution or PC01 installation.

## Immutable origin and license

- Upstream: [janl/node-jsonpointer](https://github.com/janl/node-jsonpointer), tag `v5.0.1`.
- **Pinned commit:** `4a253c0d8f0d4d7f4c01f566bf8bf16f775dcdca` ([link](https://github.com/janl/node-jsonpointer/commit/4a253c0d8f0d4d7f4c01f566bf8bf16f775dcdca)).
- Original `jsonpointer.js` Git blob: `dad907d763f7369ac0e284e7d1fae2bd5508f477` (SHA256 `4646977d4f1c4a9724a7430beeec0d7557805a0557e129d876364d9439c423f0`).
- Exact original `LICENSE.md` Git blob: `ac32f5dfdd49682b416374dcbed58a7f17fa4e24`, **MIT**; attribution and notice preserved intact.
- **Tag/package discrepancy:** `package.json` at this immutable commit declares `version: 5.0.0`, although the Git tag is `v5.0.1`. These files are pinned *Git source*, **not verified npm package bytes or a claim that package version 5.0.1 was published**.

## Run the upstream original, no dependency install

From the repository root with Node 22:

```sh
node projects/rea-reconstruction-lab/d02-node-jsonpointer/runner.mjs
node projects/rea-reconstruction-lab/d02-node-jsonpointer/runner.mjs --observe
```

The first command verifies original source and license Git blobs, executes all ten cases in a Node VM context without exposing `require` or `process` to the original, and compares the **exact NDJSON bytes** to `golden.ndjson`. The second command emits ten original outputs so observations can be independently inspected. No network access, REA install, npm install, provider, API key, or PC01 device needed. The small VM harness is **not** a general-purpose hostile-code security sandbox.

**Golden NDJSON SHA256:** `eab897112bd5948b432c90ab63040da07db6e72a32ec0963982e61d8e4bad955`.

Cases J01–J10: nested get; escaped `~1` slash get; escaped `~0` tilde get; missing get (explicit undefined sentinel); existing-key replacement; creation of nested array/object; array append `/-`; escaped slash set; invalid relative pointer error; invalid input object error. All outputs include returned values/errors and document after mutation.

Root Vitest test `tests/rea-reconstruction-lab/d02-jsonpointer-original-golden.test.ts` reruns the original using a native Node child process and fails closed if upstream source, MIT license or golden receipt is modified.

## Scope and next gate

D02 proves only the behavior of this independent upstream JavaScript utility on **ten synthetic cases**. It does not demonstrate an REA analysis trace, R05 Core atomic lease, R06 consumer-resolved lock/SBOM, host isolation, R07 MCP connectivity or R09/R10 product acceptance. D03 requires those separate security and runtime receipts; do not convert source/original tests into real REA, production or device acceptance.
