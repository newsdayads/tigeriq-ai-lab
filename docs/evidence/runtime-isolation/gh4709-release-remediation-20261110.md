# GH-4709 runtime release remediation — 2026-11-10

- Scope: continue Issue #4709 runtime acceptance after source/test completion.
- Failed runtime target: `3fa8a004460a618c51d2fae019079e80abbbb484`.
- Protected release receipt: `ROLLED_BACK` at `2026-11-10T09:48:45Z`.
- Runtime RCA: candidate Core task exited before Node startup because `D:\TigerIQ\Rebuild\credential-store.ps1` inherited writable ACLs for Everyone, Authenticated Users, and BUILTIN\Users; #1201 correctly failed closed.
- Remediation: ACL only. Credential-store bytes were not changed.
- Content SHA256 before/after: `E22AA45111500218A61403F4C7A5084D9B4E9AF5AA51B55F8B79163567499CFF`.
- Post-remediation unsafe writable ACE count: `0`.
- Effective credential-store ACL: SYSTEM FullControl; BUILTIN\Administrators FullControl.
- PC01 evidence: `D:\TigerIQ\Evidence\gh4709-credential-store-acl-remediation-20261110.json`.
- This commit intentionally changes documentation only so the guarded updater receives a fresh anti-replay target SHA while deploying the already-reviewed runtime tree from main.
