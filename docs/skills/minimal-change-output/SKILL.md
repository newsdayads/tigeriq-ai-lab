# Minimal Change Output & Destructive Rewrite Guard

This skill ensures that code changes adhere to minimal diff principles and are protected against accidental destructive truncations or massive unwanted rewrites.

## Purpose
- Prevent accidental file wiping or excessive line deletion (>30%).
- Reject large contiguous block replacements (>200 lines) with unrelated content.
- Enforce safe mutation wrappers (`wrapMutation`) across coding lane operations.

## Usage
Import `detectDestructiveChange` and `wrapMutation` from `apps/tigeriq-coding-lane/safety-guard.mjs` to validate file mutations before writing to disk.
