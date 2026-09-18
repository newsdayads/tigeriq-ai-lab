# Context Budget and Compaction

## Overview
Deterministic, local-first context filtering and compaction with hard budgets, headroom, and evidence metrics for TigerIQ core.

## Rules
1. Always enforce strict token budgeting and reserve headroom before feeding payloads to LLM providers.
2. Prioritize pinned items and high-relevance context over casual history.
3. Return transparent evidence metrics for every compaction run.
