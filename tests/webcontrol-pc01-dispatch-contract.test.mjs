import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../apps/dashboard/src/standalone.ts', import.meta.url), 'utf8');

describe('WebControl -> PC01 Secure Worker V3 dispatch contract', () => {
  it('marks Web jobs as explicit PC01-only jobs', () => {
    expect(source).toContain('PC01_REQUIRED=true');
    expect(source).toContain('CLOUD_EXECUTOR_ALLOWED=false');
    expect(source).toContain('TIGERIQ_JOB_V1');
    expect(source).toContain('## Work Order');
    expect(source).toContain('## Instruction');
  });

  it('projects the GitHub queue back into the dashboard instead of relying only on the local journal', () => {
    expect(source).toContain('new GitHubWorkSource(plane, repo)');
    expect(source).toContain('startDashboard(dashboardSource');
  });
});
