# NV03 QA-only — GitHub Review Inbox V1

Authority: Owner QA-only 11/10/2026, Issue #4649 comment 6109979504; GitHub Issue #504; Owner P0 15/10/2026.
Scope: NV03 = ChatGPT Go independent reviewer/QA only. No general P1–P5 coding or Core dispatch. App Chrome LOCAL-only continuity is unchanged.

## Sources to scan on each real NV03 QA turn

1. Open non-draft P1–P5 PRs with exact `head.sha`, diff and CI. Skip current SHA with a matching `[TIGERIQ_NV03_QA_EVIDENCE_V1]` comment. Never native `APPROVED` on one's own GitHub PR/account.
2. Open GitHub Issues that declare `<MILESTONE>_INDEPENDENT_REVIEW=NOT_ACCEPTED` (or `PENDING`, `NOT_RECEIVED`) in their **current** canonical header, even if `SOURCE_PR_STATUS=MERGED`, or their overall execution is `EXTERNAL_WAIT`. Reject P0, Owner hold, DONE, obsolete history.
3. Read the bounded read-only `/api/health-live-work` → `projection.nv03MilestoneQaInbox` on PC01 when available. `nv03MilestoneQaInboxFresh=false` or `receiptCoverage=UNVERIFIED` means reread GitHub and do not assert no duplicates. No assumption that native ChatGPT can access PC01 local HTTP or automatically reload this file.

## Milestone review evidence / anti-dup

- Candidate kind `MILESTONE_REVIEW`, key `NV03_QA|ISSUE|MILESTONE|SOURCE_SHA`. Check source Issue, actual PR/merge SHA, file diff/CI, and read all relevant Issue comments **before** writing a receipt.
- The marker for a *real* bounded preliminary QA comment is `[TIGERIQ_NV03_MILESTONE_QA_V1]` plus `WORKER=NV03`, `SOURCE_ISSUE=N`, `MILESTONE=A05`, `EXACT_SOURCE_SHA=<40-hex>`, `QA_RESULT=PRELIMINARY|CHANGES_REQUIRED|BLOCKED|REVIEWED`, and supporting findings. No repetitive report at unchanged SHA.
- This comment does **not** prove non-author GitHub approval. Distinguish the native ChatGPT UI reviewer from the underlying GitHub login, which may be the PR author's own `newsdayads` identity.
- Never set `A05_INDEPENDENT_REVIEW=ACCEPTED`, tick checklist, raise progress, or claim DONE without actual eligible independent reviewer evidence under the Work Order's distinct acceptance gate. The Owner waiver of optional AI review is not A05 PASS.
- If reviewer eligibility or exact immutable source is unavailable, mark `BLOCKED_REVIEWER_NOT_INDEPENDENT` or `MISSING_EXACT_SOURCE_SHA`, leave milestone NOT_ACCEPTED, and move to a different eligible QA item. No retry loops.

## Example #4625

- DeXCam Personal #4625: `A05_INDEPENDENT_REVIEW=NOT_ACCEPTED`, `SOURCE_PR=4815` merged, `SOURCE_MERGE_SHA=4706ea7059ed0c4cc3d0931b84d9a784dfb2ceb6`. Check current GitHub before use.
- `B01_REAL_DEVICE_EVIDENCE=NOT_RECEIVED`; A05 and B01 are independent external acceptance gates. A05 review is not ordinary Core Coding Lane reactivation; B01 needs physical-device evidence.
- This read-only discovery path is **not** a GitHub Job claim or automatic dispatch to NV03. Real native worker execution must be tested separately; do not mark E2E PASS based only on Core source/API.
