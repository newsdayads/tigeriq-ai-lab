# TigerIQ Coding Lane

Separate runtime service for autonomous repository engineering.

Flow: coding objective → AI manager → durable coding queue → API implementer → isolated GitHub branch → PR → required CI → different API reviewer → automatic fix/retest → guarded merge.

Safety:
- never writes directly to `main`;
- protected/security/deploy paths are blocked;
- official runtime uses verified free/trial API resources only;
- PC01 does not host a development worktree or local build lane;
- GitHub branch protection remains final merge authority.

Runtime target: `100.97.23.87:8797`.
