# PC01 Exact-SHA Review Procedure

For independent review jobs, never assume `HEAD~1` exists or represents the review base.

Required procedure:
1. `git fetch origin --prune`.
2. Verify target exact SHA exists with `git cat-file -e <sha>^{commit}`.
3. Checkout detached target SHA or the named feature branch pinned to that SHA.
4. Fetch the named base branch explicitly.
5. Review diff using `git diff origin/<base>...<sha>` or GitHub PR diff, not `HEAD~1`.
6. Record exact target SHA and base ref in evidence.
7. If history is shallow, fetch required refs/depth rather than failing on `HEAD~1`.
