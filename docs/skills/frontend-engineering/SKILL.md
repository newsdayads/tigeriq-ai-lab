# Frontend Engineering — P0 Core/Coding Lane candidate

ID: frontend-engineering
Version: 0.1.0
State: CANDIDATE — not runtime loadable until validated, real canary and registry promotion
Target: coding-lane / frontend

## Trigger
A scoped frontend, responsive UI, accessibility or client interaction implementation with a canonical design/specification and authorized source paths.

## Required inputs
Canonical Work Order, source SHA, permitted file paths, UI states and breakpoints, behavior/data invariants, expected artifacts and executable verification commands.

## Step-by-step prompt
1. Read the actual components, routes, styles, tests and approved design evidence.
2. State a minimal change plan and exact component files. Reject a README-only substitute for real frontend code.
3. Implement behavior and presentation without changing unrelated API/data or permissions.
4. Check type/build/lint and targeted interaction tests; visually verify mobile/desktop when an authorized browser is available.
5. Return changed paths, exact head SHA, test invocations/results, screenshot or interaction receipts where applicable, unmet criteria and next step.

## Acceptance
The referenced UI really renders, all specified states work, responsive/accessibility checks apply, scoped code and test evidence exist; generic CI success alone is insufficient. If interactive visual tests are unavailable, block only that acceptance criterion without fabricating PASS.

## Security / permissions
No credential, payment, production, browser login, App Chrome or Core control-plane mutation; isolated branch and required review gates only.

## Promotion
Canary on approved small UI fixture with negative test; deterministic measurements and authorized registry promotion are required before ACTIVE.
