# TigerIQ Autonomous Operations Feed

This document reserves the operational feed contract for Web Control. The live feed itself is represented by one canonical GitHub issue with marker `TIGERIQ_AUTONOMY_FEED_V1`; automation updates that issue instead of creating repeated status issues.

Fields expected in the live feed issue body/comments:
- CURRENT_ACTION
- CURRENT_SCOPE
- EXECUTION_CHANNEL
- LAST_PROGRESS
- NEXT_ACTION
- BLOCKER
- UPDATED_AT

The feed is status/evidence only. It must not be treated as a normal executable Work Order and must not be consumed by the bounded cloud backlog worker.
