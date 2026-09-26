# TigerIQ AI Lab — Source Review Scope

Status: ACTIVE GOVERNANCE RULE
Date: 2026-08-30

## Authoritative review target
Any Source-of-Truth/governance review must evaluate one exact current Git commit SHA. The initial review request must name that SHA. If the target branch or MAIN changes after review is queued or completed, the prior review does not automatically apply to the new head.

## Claims a Source review may evaluate
- General repository Source follows the Company Constitution and Workflow.
- Decision precedence is explicit and Constitution-controlled.
- `docs/CURRENT_STATE.md` distinguishes implemented/merged/Production state from off-MAIN verification and external/security waits.
- An off-MAIN PASS never implies merge, release, live activation, or Production.
- Restricted Owner Profile and sensitive private context are absent from the general repository.
- Evidence claims name concrete PR/branch/commit/run/issue/deployment identifiers where material.

## Superseded evidence
Evidence tied to an older commit remains historical audit evidence only and must not be reused to pass a later head without revalidation.

## Release boundary
A Source review PASS does not itself authorize application release, Production deployment, paid/cloud provider activation, credential changes, signing-identity changes, or PC01 privileged/runtime mutation. Those transitions require their own applicable gates and authorization.
