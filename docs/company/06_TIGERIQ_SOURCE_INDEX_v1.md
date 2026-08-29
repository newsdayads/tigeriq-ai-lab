# TIGERIQ — SOURCE INDEX
Version: 1.0

## ChatGPT Project “Nguồn”
Upload these files in order:
1. 01_TIGERIQ_COMPANY_CONSTITUTION_v1.md
2. 02_TIGERIQ_WORKFLOW_v1.md
3. 03_TIGERIQ_AI_EMPLOYEE_MODEL_v1.md
4. 05_TIGERIQ_DECISION_LOG_V1.md

## Restricted/private
5. 04_TIGERIQ_OWNER_PROFILE_v1.md
Only upload this to a private/restricted source if the project supports appropriate access controls. Do not distribute it as company-wide source.

## Repository policy
Architecture, implementation ADRs, work orders, CI records, CURRENT_STATE, test evidence, and deployment records remain in the repository as engineering Source of Truth and should be referenced rather than duplicated unnecessarily.

The private Owner Profile is intentionally NOT committed to the general repository.

## Precedence
Constitution > Workflow > AI Employee Model > Decision Log > engineering implementation docs, unless a newer explicitly approved decision supersedes them.

## Provenance and baseline
These general Company Source documents become the repository baseline only through PR #11 independent review and release gate. The repository does not contain an external byte-for-byte source artifact, so it does not claim an exact external-copy comparison. Review instead verifies internal consistency with current Owner instruction, Constitution precedence, privacy boundaries, and recorded engineering evidence. Once PR #11 is approved, its merge commit is the immutable provenance for this baseline; later changes require a new reviewed decision.
