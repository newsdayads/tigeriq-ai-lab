# TigerIQ API Health Core UI — pstack verification pilot

## Identity
- ID: pstack-core-ui-verification
- State: **CANDIDATE / NOT ACTIVE / NOT INSTALLED ON PC01**.
- Source: [Cursor pstack](https://github.com/cursor/plugins/tree/main/pstack), MIT; create-verification-skill source blob 140d033a001e8d27acd14b06004506c43053b199 and maintain-verification-skill source blob a2680b91fead45a0b4963d8c367a854956bea59d (2026-10-18).
- Translation: portable, standalone read-only Node + Playwright pilot. Not the whole pstack runtime or a second Core scheduler. No Cursor installation required for the script.

## Why
TigerIQ already has Playwright tests that intercept API calls with fixture responses. They prove UI rendering but do not prove a real running application. The reusable practice from pstack is **Launch → Doctor → Drive → Evidence → Cleanup** using a feature map.

## Launch
- Prerequisite: an operator has already started an **isolated, authorized API Health sandbox** with independent state/profile and its own loopback port.
- A safe universal sandbox launch/seed command has NOT been confirmed for PC01. If unavailable return BLOCKED rather than inventing a startup method.
- Shared Core/Production port 3150, Paperclip port 3210 and live NV02/NV03/NV04 browser sessions are forbidden.

## Doctor
- Requires Node.js >=20, existing repo Playwright and Chrome; check actual availability at runtime.
- Read GET /api/status and GET /api/health-live-work. Reject redirected, non-JSON, stale (>120 seconds), absent or duplicate Issue and non-loopback target.
- Health/API read is not proof of a Core lease or a running executor job.

## Drive
From the repo root, on an already running authorized isolated sandbox:

    node scripts/verify-core-ui-sandbox.mjs --base-url http://127.0.0.1:PORT/ --issue ISSUE_NUMBER --evidence-dir artifacts/pstack-verification/UNIQUE_RUN_ID

The harness opens a new isolated Chrome context without request mocking, selects the matching work card, opens its detail modal, validates the GitHub link when supplied by the API and captures before/after state.

## Evidence
- Scoped output: artifacts/pstack-verification/UNIQUE_RUN_ID/receipt.json and core-ui-work-card.png.
- Report source API timestamp, selected Issue, action, UI result, and acceptanceVerified:false.
- SANDBOX_DIAGNOSTIC_PASS is **not** Core Work Order completion, PC01 installed verification, or Production acceptance.
- node --test tests/pstack-core-ui-verification.test.mjs uses unit fakes; it is **contract-only**, not a device/live receipt.

## Cleanup
Close only the newly opened browser. Never kill/restart Core, disturb a shared process, clear an existing profile or erase evidence. Sandbox lifecycle is controlled by its authorized operator.

## Feature map
- [Open a work card and its detail](features/work-card.md). Only one feature is in scope.

## Maintenance / promotion gate
Follow the upstream maintain-verification approach: read source, drive mapped features live, preserve evidence; distinguish documentation drift from product failures. No product code changes in feature-map maintenance.

Candidate promotion requires actual TigerIQ Registry review and a real isolated sandbox run. No implicit ACTIVE Skill loading or Core/Coding Lane enforcement from this source PR.
