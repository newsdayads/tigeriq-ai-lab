# WO-001 Source Review Scope

Status: REVIEW TARGET DEFINITION
Date: 2026-08-29

## Authoritative review target
A WO-001 review must evaluate one exact current Git commit of branch `chore/source-of-truth-bootstrap` / PR #11.

A review request must state that exact commit SHA in its initial body. Do not change the target by later comment. If the branch changes after a review is queued or completed, that review does not apply to the new head.

## Claims the review may evaluate
- The general repository Source follows the Company Constitution and Workflow.
- Decision precedence is explicit and Constitution-controlled.
- `docs/CURRENT_STATE.md` separates `MAIN / MERGED`, `VERIFIED OFF-MAIN`, and `EXTERNAL / SECURITY WAIT`.
- An off-MAIN PASS never implies merge, release, live activation, or Production.
- Restricted Owner Profile and sensitive private context are absent from the general repository.
- Evidence claims name concrete PR/branch/commit/run/issue identifiers where material.

## Superseded evidence
Previous WO-001 review attempts target older repository states and are not evidence for a later head. They remain historical audit records only and must not be used to pass the current head.

## Release boundary
A Source review PASS does not authorize merging PR #11, merging the runtime stack, activating paid/cloud providers, changing Android signing identity, or deploying Production. Those transitions require their own applicable gates and authorization.
