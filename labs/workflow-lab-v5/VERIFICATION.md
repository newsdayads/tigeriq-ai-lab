# Workflow Lab V5 — verified evidence and release gates

> Read-only isolated lab. Work order [#4636](https://github.com/newsdayads/tigeriq-ai-lab/issues/4636), integration [PR #4637](https://github.com/newsdayads/tigeriq-ai-lab/pull/4637). This document describes *observed* acceptance evidence, not authorization to merge or bypass security.

## GitHub coverage: PC01 canary, 2026-10-10

An existing authorized PC01 GitHub CLI session read the public central repository with the same REST pagination parameters as the isolated adapter:

`GET /repos/newsdayads/tigeriq-ai-lab/issues?state=all&per_page=100&sort=updated&direction=asc&since=<cursor>&page=<1..8>`

It advanced the UTC timestamp cursor with a one-second overlap and de-duplicated by issue number. **47 pages / six windows / 4,646 unique records** reached a short final page with `COMPLETE=true` and no pagination error. The result split into **2,803 GitHub issues** and **1,843 pull requests**. Separate GitHub Search API counts (`is:issue`, `is:pr`) matched and reported `incomplete_results=false`. The six PC01 window durations were 12.7 s, 12.7 s, 15.6 s, 16.2 s, 14.6 s and 13.2 s. [Timestamped work-order evidence](https://github.com/newsdayads/tigeriq-ai-lab/issues/4636#issuecomment-6095997219).

**Limitation:** PC01 CLI pagination success is not evidence that the Vercel Function and browser downloaded the complete dataset within their independent network/runtime budgets. Never mark deployed coverage complete from counts alone. The UI and adapter intentionally report partial-source conditions.

## Vercel protected Preview: not accepted

- Isolated deployment `dpl_7LowrZN33LC6PsELWAcaKaj1qWdY` was `READY`, with its `index.html` and read-only `api/portfolio` lambda present, and project SSO protection enabled.
- An actual PC01 Chrome browser test on 2026-10-10 navigated to the deployment URL but landed on `https://vercel.com` **Login – Vercel** (HTTP 200 login page), not the Workflow Lab UI. This is an *authentication gate*, not application E2E success.
- Required next proof: with an already authorized authenticated browser/Vercel session, verify actual `/api/portfolio` JSON, the main portfolio view, project drilldown, issue drilldown, navigation, and explicit coverage warnings. Do not expose session secrets or disable/bypass SSO to manufacture a PASS.

## GitHub review / merge gates

- At inspection, the repository GitHub collaborators API returned only `newsdayads`, the author of PR #4637. An independent non-author GitHub review cannot be fabricated with this identity; use a genuinely authorized independent reviewer or an explicitly permitted Owner waiver **only if the canonical gate policy permits**.
- On 2026-10-10, `main` was merged **into the feature branch only** via GitHub's update-branch API with the expected previous HEAD. This does not modify `main` or ship Production. Verify the latest exact HEAD GitHub checks after this synchronization; earlier green checks on an ancestor commit do not cover a new merge commit.
- Do not merge into `main`, promote a Vercel deployment, or declare work order `DONE` until the independent review/authorized policy gate, exact-HEAD mandatory CI, and authenticated Preview API/UI acceptance are evidenced.

## Scope boundaries

No App Chrome or TigerIQ Core production mutations, no Deployment Protection relaxation, no new credentials, no paid resources, and no scheduled background worker. Retain the current issue and PR as the durable checkpoint; do not open duplicate work orders.
