import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const launcherUrl=new URL('../scripts/tigeriq-core/run-web-control-bundle.ps1',import.meta.url);

describe('Web Control runtime bundle',()=>{
  it('copies transitive workforce registry dependency',async()=>{
    const source=await readFile(launcherUrl,'utf8');
    expect(source).toContain("$.Name -eq 'workforce-registry.mjs'");
    expect(source).toContain("$.Name -eq 'github-shared-client.mjs'");
  });

  it('bundles optional fail-closed Owner approval validator for PC runtime',async()=>{
    const source=await readFile(launcherUrl,'utf8');
    expect(source).toContain("$approvalSrc=Join-Path $repo 'apps\\shared\\owner-one-tap-approval.mjs'");
    expect(source).toContain("OWNER_APPROVAL_SOURCE_MISSING");
    expect(source).toContain("$approvalDst=Join-Path $root 'owner-one-tap-approval.mjs'");
  });
});
