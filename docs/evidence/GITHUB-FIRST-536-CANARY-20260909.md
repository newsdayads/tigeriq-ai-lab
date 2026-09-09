# GITHUB-FIRST #536 CANARY — 2026-09-09

Purpose: prove repo-side work can be executed directly through the GitHub connector without using PC01/CMD as the coding path.

Verified direct actions in this canary:
- OFF-MAIN branch created directly from GitHub: `issue-536-github-first-canary`.
- This evidence file was written directly through the GitHub contents API.
- No PC01, Remote CMD, PowerShell, local worktree, Ollama, browser, or runtime action was used to create this branch/file.

Expected next proof:
- Open a draft PR directly from this branch.
- Use GitHub-side CI/review where available.

Classification: `GITHUB_ONLY`.

STATE: `GITHUB_FIRST_DIRECT_WRITE_PROVEN`
