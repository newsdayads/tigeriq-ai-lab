# GH-5097 — Windows-native benchmark scorer demo

Runnable scorer smoke for the previously merged shifted-line-count fix. This is **not** a Cline/NV09 agent evaluation.

Requirements: Node.js 20+ on PATH. No npm install, login, API token, browser, paid service or PC01 needed.

- Windows: run `RUN_DEMO.cmd` from this directory. The launcher uses `pushd/popd` for local and UNC paths, checks Node and returns its actual exit code.
- macOS/Linux: run `node run-demo.mjs`.

The demo creates three temporary deliberately broken fixtures (baseline **0/3**), verifies that adding a single comment changes exactly one line, then applies **known-good reference patches only in the temporary `src/` files** and scores the real Node acceptance tests (**3/3**). It must never be reported as Cline or NV09 independently solving the tasks.

Native Windows CI: `.github/workflows/gh5097-windows-scorer.yml` runs `RUN_DEMO.cmd` with `cmd.exe` on the standard GitHub `windows-latest` runner under a path containing Vietnamese characters and spaces. The public repository has access to standard free hosted runners. The actual PR workflow receipt, not this README, determines Windows acceptance.

Original bugfix: https://github.com/newsdayads/tigeriq-ai-lab/pull/5098

Canonical Work Order: https://github.com/newsdayads/tigeriq-ai-lab/issues/5097
