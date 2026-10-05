import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const launcherUrl=new URL('../scripts/tigeriq-core/run-web-control-bundle.ps1',import.meta.url);

describe('Web Control runtime bundle',()=>{
  it('copies transitive workforce registry dependency',async()=>{
    const source=await readFile(launcherUrl,'utf8');
    expect(source).toContain("$.Name -eq 'workforce-registry.mjs'");
    expect(source).toContain("$.Name -eq 'github-shared-client.mjs'");
  });
});
