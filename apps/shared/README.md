# Shared modules — source-change verification

This directory contains modules imported by TigerIQ Core, API surfaces, and supporting packages. A change under `apps/shared/` can alter running behavior even when no file under `apps/tigeriq-core/` changes.

## Canonical verification path

1. A pull request changing a file in this directory passes the repository's exact-head checks and is merged into protected `main`.
2. GitHub Actions `TigerIQ Core Event Dispatch` receives a **real** `push` event for `main`, reads the bounded GitHub compare changed-file set, and submits it via the existing authenticated OIDC/HTTPS bridge.
3. Core verifies event identity, durably deduplicates the delivery, and checks `githubContinuousVerifyTrigger` against the changed paths.
4. The Core continuous verifier queues and completes a bounded self-audit; its event sequence can be checked locally with `GET /api/continuous-verify-evidence?sha=<40-hex-main-sha>`.

A passing PR, successful workflow, installed SHA, or healthy Core process alone does **not** prove that the final Core event callback ran. Keep the native `CONTINUOUS_VERIFY_TRIGGER_QUEUED` and `CONTINUOUS_VERIFY_RUN` receipts for that assertion.

This document was introduced as the single-path, documentation-only, shared-directory push canary for Work Order GH-5169. It does not modify application behavior or credentials.
